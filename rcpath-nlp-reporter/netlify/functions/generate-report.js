\
const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");

// Helpers
Handlebars.registerHelper("eq", (a, b) => String(a) === String(b));

function readDatasetFiles(datasetId) {
  const base = path.join(process.cwd(), "datasets", datasetId);
  const schema = JSON.parse(fs.readFileSync(path.join(base, "schema.json"), "utf-8"));
  const rules = JSON.parse(fs.readFileSync(path.join(base, "rules.json"), "utf-8"));
  const template = fs.readFileSync(path.join(base, "template.txt"), "utf-8");
  return { schema, rules, template };
}

function safeJsonParse(maybeJsonText) {
  if (!maybeJsonText) return null;
  try { return JSON.parse(maybeJsonText); } catch {}
  // try to extract first {...}
  const m = maybeJsonText.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch {}
  return null;
}

function applyDefaults(schema, obj) {
  const out = { ...(obj || {}) };
  const props = schema?.properties || {};
  for (const [k, v] of Object.entries(props)) {
    if (out[k] === undefined) {
      if (v && Object.prototype.hasOwnProperty.call(v, "default")) out[k] = v.default;
    }
  }
  // required dataset_id (const)
  if (schema?.properties?.dataset_id?.const) out.dataset_id = schema.properties.dataset_id.const;
  return out;
}

function computePN(rules, nodesPositive) {
  const mapping = rules?.pn_mapping_by_positive_nodes || [];
  const n = Number.isFinite(nodesPositive) ? nodesPositive : 0;
  for (const band of mapping) {
    if (n >= band.min && n <= band.max) return band.set;
  }
  return "NX";
}

function computePT(rules, record) {
  // Prefer explicit pT if provided and not defaulted? We'll still recompute from phrase/category.
  const phrase = (record.depth_of_invasion_phrase || "").toLowerCase();
  const cat = (record.depth_of_invasion_category || "").toLowerCase();

  const mapping = rules?.pt_mapping || [];
  for (const rule of mapping) {
    for (const pat of (rule.match_any || [])) {
      const p = String(pat).toLowerCase();
      if (phrase.includes(p) || cat.includes(p)) return rule.set;
    }
  }

  // category fallback
  const category = record.depth_of_invasion_category || "";
  switch (category) {
    case "Invasion of lamina propria": return "T1a";
    case "Invasion of submucosa": return "T1b";
    case "Invasion of muscularis propria": return "T2";
    case "Invasion beyond muscularis propria": return "T3";
    case "Invades pleura, pericardium or diaphragm": return "T4a";
    case "Invades aorta, vertebrae or trachea": return "T4b";
    case "High-grade dysplasia": return "Tis";
    case "No tumour identified": return "T0";
    default: return record.pT || "TX";
  }
}

function computeRStatus(rules, record) {
  const triggers = rules?.r_status_rules?.R1_if_any || [];
  for (const t of triggers) {
    const val = String(record[t.field] ?? "");
    if (t.equals && val === t.equals) return "R1";
    if (t.contains && val.includes(t.contains)) return "R1";
  }
  return "R0";
}

function mandardDescriptor(rules, trg) {
  if (!trg) return "";
  const d = rules?.mandard_descriptors?.[String(trg)];
  return d || "";
}

function diffCaveats(inputText, extracted, schema) {
  // Heuristic: if the input doesn't mention a concept, call it a default.
  // This isn't perfect, but it's a practical "heads up".
  const caveats = [];
  const t = (inputText || "").toLowerCase();

  const checks = [
    ["lvi", ["lvi", "lymphovascular"], "LVI defaulted"],
    ["pni", ["pni", "perineural"], "PNI defaulted"],
    ["serosal_involvement", ["serosa", "serosal"], "Serosal involvement defaulted"],
    ["neoadjuvant_therapy_history", ["neoadjuvant", "chemo", "radiotherapy", "chemoradi"], "Neoadjuvant therapy history defaulted"],
    ["tumour_regression_grade", ["mandard", "regression", "trg"], "Tumour regression grade defaulted/absent"],
    ["proximal_margin", ["proximal margin"], "Proximal margin defaulted"],
    ["distal_margin", ["distal margin"], "Distal margin defaulted"],
    ["circumferential_margin_status", ["crm", "circumferential"], "CRM status defaulted"],
    ["distance_to_crm_mm", ["mm", "crm"], "CRM distance defaulted"],
    ["nodes_examined", ["node", "nodes"], "Node counts defaulted"],
    ["pm1_disease", ["metast", "m1"], "pM1 defaulted"],
  ];

  for (const [field, needles, msg] of checks) {
    const mentioned = needles.some(n => t.includes(n));
    if (!mentioned) {
      // Only add if field has schema default and equals that default
      const def = schema?.properties?.[field]?.default;
      if (def !== undefined && String(extracted[field]) === String(def)) caveats.push(msg);
    }
  }

  // Inferences
  caveats.push(`pT inferred as ${extracted.pT} from depth wording/category.`);
  caveats.push(`pN inferred as ${extracted.pN} from nodes positive (${extracted.nodes_positive}).`);
  if (extracted.nodes_positive > 0 && !String(extracted.positive_node_stations || "").trim()) {
    caveats.push("Positive node station(s) not supplied (local field).");
  }
  return caveats;
}

exports.handler = async (event) => {
  try {
    const { text, datasetId } = JSON.parse(event.body || "{}");
    if (!text || !datasetId) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing text or datasetId" }) };
    }

    const { schema, rules, template } = readDatasetFiles(datasetId);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "OPENAI_API_KEY not set in Netlify environment variables." }) };
    }
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // Prompt: extract to JSON only (fields), then we compute pT/pN/R and render deterministically.
    const system = [
      "You are a pathology reporting assistant.",
      "Extract structured fields from the user's one-line description.",
      "IMPORTANT: If a feature is not mentioned, do NOT leave it blank; set it to the schema default.",
      "Do not include any commentary. Output JSON only."
    ].join(" ");

    const user = {
      instruction: "Fill this JSON object with values from the text. Follow enums exactly. Output JSON only.",
      schema_hint: schema,
      text
    };

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(user) }
        ],
        // Keep output short: just JSON.
        max_output_tokens: 900
      })
    });

    const raw = await resp.json();
    if (!resp.ok) {
      return { statusCode: resp.status, body: JSON.stringify({ error: raw?.error?.message || "OpenAI request failed", raw }) };
    }

    // Responses API returns different shapes; try to pull text.
    let outText = "";
    if (raw.output_text) outText = raw.output_text;
    else if (raw.output && Array.isArray(raw.output)) {
      // Try to concatenate any text segments
      for (const o of raw.output) {
        if (o.content && Array.isArray(o.content)) {
          for (const c of o.content) if (c.type === "output_text" && c.text) outText += c.text;
        }
      }
    }

    const extracted0 = safeJsonParse(outText);
    if (!extracted0) {
      return { statusCode: 500, body: JSON.stringify({ error: "Model did not return valid JSON.", model_output: outText }) };
    }

    // Apply schema defaults and compute derived fields
    const extracted = applyDefaults(schema, extracted0);

    extracted.pT = computePT(rules, extracted);
    extracted.pN = computePN(rules, extracted.nodes_positive);
    extracted.r_status = computeRStatus(rules, extracted);

    if (String(extracted.tumour_regression_system || "") === "Mandard" && extracted.tumour_regression_grade) {
      extracted.mandard_descriptor = mandardDescriptor(rules, extracted.tumour_regression_grade);
    } else {
      extracted.mandard_descriptor = "";
    }

    // Render report
    const compiled = Handlebars.compile(template, { noEscape: true });
    let report_text = compiled(extracted);

    // Hard ban phrases in report_text
    const forbidden = ["not stated", "derived from", "inferred", "assumed"];
    const lower = report_text.toLowerCase();
    if (forbidden.some(f => lower.includes(f))) {
      // strip lines containing them (failsafe)
      report_text = report_text.split("\n").filter(line => !forbidden.some(f => line.toLowerCase().includes(f))).join("\n");
    }

    // Caveats list (separate box)
    const caveats = diffCaveats(text, extracted, schema);

    return {
      statusCode: 200,
      body: JSON.stringify({ report_text, caveats, extracted_fields: extracted })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || "Server error" }) };
  }
};
