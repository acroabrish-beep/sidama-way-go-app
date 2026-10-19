# Responsible AI Documentation: Citizen Report Triage

## Purpose

The AI triage system assists city administrators in categorizing and prioritizing citizen reports for Hawassa. It provides initial suggestions for category (pothole, garbage, street_light, water, other), urgency level (low, medium, high), and a brief English summary. The system is designed to improve response times and ensure high-urgency issues are identified quickly.

## Model Used

- **Model:** Google Gemini 1.5 Flash
- **Provider:** Google Generative AI
- **API Key:** Configured via `GEMINI_API_KEY` environment variable
- **Timeout:** 10 seconds per request to prevent hanging

## Data Sent to AI

**What IS sent:**
- Report description (redacted of personal data)
- User-selected category (as context)
- System prompt with triage instructions

**What is NEVER sent:**
- Personal identifiers (names, phone numbers, email addresses, long digit sequences are redacted)
- GPS coordinates
- Photo URLs
- Firebase UIDs
- User names or addresses
- Any other personally identifiable information

**Redaction process:**
- Phone numbers (Ethiopian formats: +251..., 09..., etc.) → `[PHONE]`
- Email addresses → `[EMAIL]`
- Long digit sequences (10+ digits) → `[ID]`

## Human Oversight

The AI **only suggests**. It never:
- Closes a report
- Assigns a report to a worker
- Rejects a report
- Makes final decisions

**Human workflow:**
1. Citizen submits report
2. AI provides suggestions (category, urgency, summary)
3. Administrator reviews suggestions
4. Administrator can accept or override AI suggestions (sets `final_category`, `final_urgency`)
5. Administrator manually assigns report and changes status
6. Administrator manually resolves report

The system tracks agreement rate between AI suggestions and final admin decisions for evaluation purposes.

## Known Limitations

**Language coverage:**
- English: Good coverage
- Amharic: Moderate coverage (model may struggle with complex sentences)
- Sidaamu Afoo: Limited coverage (very low-resource language)
- Other languages: Not supported

**Error modes:**
- API key not configured → triage skipped (marked as `ai_status: 'skipped'`)
- API timeout (10s) → triage failed (marked as `ai_status: 'failed'`)
- Invalid JSON response → triage failed
- Out-of-range values → triage failed

**Confidence scoring:**
- Model outputs confidence 0.0 to 1.0
- Low confidence indicates uncertainty (e.g., unclear language, ambiguous description)
- Administrators should review low-confidence suggestions more carefully

## Bias Checking

**Evaluation framework:**
- Per-language accuracy metrics (English, Amharic, Sidaamu Afoo)
- Per-category accuracy metrics
- Urgency classification accuracy
- Agreement rate with human decisions (when final_category is set)

**Evaluation data:**
- 40 synthetic test samples (never real citizen data)
- Balanced across 5 categories and 3 languages
- Run via `npm run eval:triage` before deployment
- Results stored in `eval/results.json` and `eval/results.md`

**Important note:** Amharic and Sidaamu Afoo test samples are machine-written and MUST be reviewed by a native speaker before being quoted in any report.

## Data Retention

**Current status:** Placeholder for city partner decision

**Recommendations:**
- AI suggestions stored in database (`ai_*` columns) for audit trail
- Original report descriptions retained
- Consider retention period for AI logs (e.g., 12 months)
- Consider anonymization policies for long-term storage

**City partner to decide:**
- How long to retain AI triage results
- Whether to export AI metrics for external reporting
- Data deletion policies for resolved reports

## Failure Handling

**AI triage failures do NOT block report submission:**
- Report is created first
- AI triage runs asynchronously
- If AI fails, report is still created and usable
- AI status tracked: `pending`, `done`, `failed`, `skipped`

**Fallback behavior:**
- No API key → skip AI, mark as `skipped`
- Timeout/error → mark as `failed`, report still usable
- Invalid response → mark as `failed`, report still usable

**Administrator can still:**
- Manually categorize failed/skipped reports
- Manually set urgency
- Process reports normally without AI assistance

## Monitoring and Improvement

**Metrics available:**
- AI success rate (done vs failed vs skipped)
- Agreement rate with human decisions
- Per-language accuracy
- Per-category accuracy
- Median time to assign and resolve

**Continuous improvement:**
- Regular evaluation runs with updated test data
- Review wrong answers in evaluation reports
- Adjust system prompt based on findings
- Consider model upgrades as they become available

## Contact

For questions or concerns about the AI triage system, contact the Sidama Way Go technical team.
