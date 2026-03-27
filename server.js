/**
 * CompetencyPath – Server v2.1
 * By Dr. Michael Adelani Adewusi · Kampala International University, Uganda
 *
 * Setup:
 *   1. npm install
 *   2. Create a .env file:  ANTHROPIC_API_KEY=sk-ant-...   PORT=3000
 *   3. npm start   (or  npm run dev  for auto-reload)
 *
 * v2.1 fixes:
 *   - Check stop_reason === 'max_tokens' to catch silently truncated JSON
 *   - Switched to claude-opus-4-5 which supports up to 32k output tokens
 *   - Hardened extractJson with bracket-depth repair for near-complete JSON
 *   - Added raw output logging on every parse failure for easier debugging
 */

require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const Anthropic  = require('@anthropic-ai/sdk');

// ── Validation ────────────────────────────────────────────────────
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('\n❌  ANTHROPIC_API_KEY is missing. Add it to your .env file.\n');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── App setup ─────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limiting ─────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests – please wait 15 minutes before trying again.' }
});
app.use('/api/generate-course-design', limiter);

// ── Health check ──────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '2.1.0', timestamp: new Date().toISOString() });
});

// ── System prompt ─────────────────────────────────────────────────
const SYSTEM_PROMPT = `
You are an expert instructional designer specialising in Competency-Based Education (CBE) for higher education in sub-Saharan Africa, specifically Kampala International University (KIU), Uganda.

You receive a course or unit write-up and must generate a complete, rigorous CBE course design as a single strict JSON object — no prose, no markdown fences, no explanation outside the JSON.

CRITICAL QUALITY STANDARDS you MUST enforce:

STEP 3 — SMART Objectives:
  - "measurable" MUST state PERFORMANCE INDICATORS (scores, rubric levels, demonstrations) — NOT activities like "complete the quiz" or "watch the video".
  - "achievable" MUST discuss learner cognitive load, prior knowledge, and scaffolding — NOT tools or resources.
  - Each complete objective MUST follow: "By [deadline], learners will be able to [observable action verb] [specific outcome] as demonstrated by [performance evidence]."

STEP 4 — Notional Hours (MOST CRITICAL):
  Every topic row MUST contain four separate hour values:
    - hoursDirected: instructor-led time (lectures, demonstrations, webinars). Typically the SMALLEST share.
    - hoursSelfDirected: learner-paced independent study (readings, research, note-making).
    - hoursApplied: active competency practice (case analysis, practicals, simulations, problem sets, projects). This MUST be the LARGEST or second-largest share.
    - hoursAssessed: time spent on graded evidence-producing tasks (assignments, tests, portfolio work).
  CBE balance rule: hoursApplied + hoursAssessed MUST exceed 50% of the topic total. If your draft violates this, revise it.
  "learnerActivity" MUST describe specifically WHAT learners DO — not what the instructor does. Use active verbs: "Learners analyse...", "Learners construct...", "Learners debate...".
  "activityRationale" MUST explain WHY this activity builds the target competency from a student-centred learning theory perspective (e.g. Kolb's experiential learning, Zone of Proximal Development, deliberate practice, constructivism). This field must not be generic.

STEP 5 — Assessments:
  - Rubric MUST include 4 levels per criterion: Excellent / Proficient / Developing / Beginning — each with a concrete, observable descriptor.
  - competencyAlignment MUST map every assessment to specific competencies.
  - masteryJustification MUST cite institutional policy, industry standards, or CBE research — not just state a number.

STEP 8 — Flexible Paths:
  - All paths MUST describe WITHIN-COURSE branching based on diagnostic or gate-quiz results.
  - rplProvision MUST describe a concrete RPL process with portfolio evidence and challenge exam.

STEP 9 — Metrics:
  Every metric in successMetrics MUST include a baseline and a numeric target. Format: "Metric name: baseline X%, target ≥Y%".

Respond ONLY with the JSON object below, fully populated. All string fields must be substantive (never empty, never "N/A").

Required JSON schema:
{
  "unitName": "string — full course/unit title",
  "unitDescription": "string — 2–3 sentences: what it covers, who it is for, why it matters",

  "step1": {
    "currentState": "string",
    "desiredState": "string",
    "gaps": "string",
    "priority": "Critical|High|Medium|Low"
  },

  "step2": {
    "competencies": ["string"],
    "knowledgeAreas": "string",
    "skills": ["string"],
    "mappingNotes": "string"
  },

  "step3": {
    "specific": "string",
    "measurable": "string — performance indicators only, not activities",
    "achievable": "string — learner capability, scaffolding, cognitive load",
    "relevant": "string",
    "timeBound": "string",
    "completeObjectives": "string — 3–5 objectives, one per line, full SMART format"
  },

  "step4": {
    "contentOverview": "string",
    "topicPlans": [
      {
        "topic": "string",
        "keyContent": "string",
        "hoursDirected": "number as string e.g. '1'",
        "hoursSelfDirected": "number as string e.g. '1.5'",
        "hoursApplied": "number as string e.g. '2'",
        "hoursAssessed": "number as string e.g. '1.5'",
        "learnerActivity": "string — specific active description of what learners DO",
        "activityRationale": "string — student-centred theory-grounded justification for why this activity builds the competency",
        "competencyLink": "string — which competency from step2 this topic addresses"
      }
    ],
    "contentRationale": "string"
  },

  "step5": {
    "formative": "string",
    "summative": "string",
    "rubric": "string — 4 levels per criterion with concrete descriptors",
    "evidenceType": ["string"],
    "passingCriteria": "string",
    "competencyAlignment": "string",
    "masteryJustification": "string"
  },

  "step6": {
    "modality": "Fully Online|Blended / Hybrid|Face-to-Face|Self-paced|Synchronous Virtual",
    "tools": ["string"],
    "contentFormats": ["Video Lectures","Reading Materials","Interactive Simulations","Case Studies","Podcasts","Infographics","Live Webinars","Discussion Forums"],
    "accessibilityNotes": "string"
  },

  "step7": {
    "activities": "string",
    "collaboration": "string",
    "gamification": "string",
    "realWorld": "string"
  },

  "step8": {
    "prerequisites": "string",
    "paths": "string — within-course branching based on diagnostics",
    "selfPacedProgression": "string",
    "competencyUnlocking": "string",
    "optionalContent": "string",
    "adaptations": "string",
    "rplProvision": "string — concrete RPL process with portfolio and challenge exam"
  },

  "step9": {
    "feedbackMechanisms": ["Automated Quiz Feedback","Instructor Comments","Peer Review","Self-Assessment","Learning Analytics","End-of-Unit Surveys","1-on-1 Check-ins"],
    "feedbackSchedule": "string",
    "improvementLoop": "string",
    "successMetrics": ["string — each with baseline and numeric target"]
  }
}
`.trim();

// ── Robust JSON extraction ────────────────────────────────────────
/**
 * Attempts to extract a valid JSON object from a string using 4 strategies:
 *   1. Direct parse
 *   2. Strip markdown fences then parse
 *   3. Slice from first { to last } then parse
 *   4. Bracket-depth repair: close any unclosed braces/brackets
 *      (handles truncated responses that are 95%+ complete)
 */
function extractJson(text) {
  // Strategy 1 — direct parse
  try { return JSON.parse(text); } catch (_) {}

  // Strategy 2 — strip markdown fences
  const stripped = text
    .replace(/^[\s\S]*?```(?:json)?\s*/i, '')
    .replace(/\s*```[\s\S]*$/i, '')
    .trim();
  if (stripped.startsWith('{')) {
    try { return JSON.parse(stripped); } catch (_) {}
  }

  // Strategy 3 — outermost { ... }
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {}
  }

  // Strategy 4 — bracket-depth repair for truncated but near-complete JSON
  if (start !== -1) {
    const partial = text.slice(start);
    const repaired = repairTruncatedJson(partial);
    if (repaired) {
      try { return JSON.parse(repaired); } catch (_) {}
    }
  }

  return null;
}

/**
 * Closes any unclosed braces and brackets in a truncated JSON string.
 * Strips trailing incomplete key/value pairs before closing.
 */
function repairTruncatedJson(text) {
  try {
    const stack = [];
    let inString = false;
    let escape = false;
    let lastSafePos = 0;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (ch === '{' || ch === '[') {
        stack.push(ch === '{' ? '}' : ']');
      } else if (ch === '}' || ch === ']') {
        if (stack.length && stack[stack.length - 1] === ch) {
          stack.pop();
          if (stack.length === 0) lastSafePos = i + 1; // complete top-level object ended
        }
      } else if ((ch === ',' || ch === ':') && stack.length === 1) {
        lastSafePos = i; // last safe separator at top level
      }
    }

    if (stack.length === 0) return text; // already valid

    // Trim back to last safe position and close all open brackets
    const trimmed = text.slice(0, lastSafePos).replace(/[,\s]+$/, '');
    return trimmed + stack.reverse().join('');
  } catch (_) {
    return null;
  }
}

// ── POST /api/generate-course-design ─────────────────────────────
app.post('/api/generate-course-design', async (req, res) => {
  const { combinedInput } = req.body;

  if (!combinedInput || typeof combinedInput !== 'string' || combinedInput.trim().length < 30) {
    return res.status(400).json({
      error: 'combinedInput must be a non-empty string of at least 30 characters.'
    });
  }

  try {
    const message = await anthropic.messages.create({
      // FIX 1: Use claude-opus-4-5 — supports up to 32k output tokens,
      //         preventing truncation of this large JSON schema.
      //         claude-sonnet-4-5 is capped at 8192 output tokens which
      //         this schema regularly exceeds.
      model:      'claude-opus-4-5',
      max_tokens: 16000,
      system:     SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Generate a complete CBE course design from the following write-up. Apply every quality standard from your instructions. Return ONLY the raw JSON object — no markdown, no explanation, no text before or after the JSON.\n\n---\n${combinedInput.trim()}\n---`
        },
        {
          role: 'assistant',
          content: '{'  // Prefill: forces Claude to start with { — no preamble possible
        }
      ]
    });

    // FIX 2: Check stop_reason BEFORE attempting to parse.
    //         'max_tokens' means Claude was cut off mid-JSON — this was the
    //         silent cause of most "malformed JSON" errors in v2.0.
    if (message.stop_reason === 'max_tokens') {
      console.error(
        'Generation truncated: stop_reason=max_tokens.\n' +
        'The course write-up may be too large, or the schema output exceeded max_tokens.\n' +
        'Raw tail (last 300 chars):\n',
        ('{' + message.content.filter(b => b.type === 'text').map(b => b.text).join('')).slice(-300)
      );
      return res.status(502).json({
        error:
          'The AI response was cut off before the JSON could be completed. ' +
          'Please try again with a shorter course write-up, or break it into smaller units.'
      });
    }

    // Prepend the prefill character Claude continued from
    const raw = '{' + message.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const parsed = extractJson(raw);

    if (!parsed) {
      // Log the raw output so you can inspect it in Render logs
      console.error(
        'JSON parse failure (all 4 strategies failed).\n' +
        'stop_reason:', message.stop_reason, '\n' +
        'Raw output (first 1500 chars):\n', raw.slice(0, 1500), '\n' +
        'Raw output (last 500 chars):\n', raw.slice(-500)
      );
      return res.status(502).json({
        error: 'The AI returned malformed JSON. Please try again.'
      });
    }

    return res.json(parsed);

  } catch (err) {
    console.error('Anthropic API error:', err.message);
    const status  = err.status || 500;
    const message = err.message || 'Unexpected server error.';
    return res.status(status).json({ error: message });
  }
});

// ── SPA fallback ──────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  CompetencyPath v2.1 running at http://localhost:${PORT}`);
  console.log(`   API key: ${process.env.ANTHROPIC_API_KEY ? '✔ loaded' : '✘ MISSING'}\n`);
});
