#!/usr/bin/env node

/**
 * Daily Scan + Evaluate + Draft
 *
 * Runs every morning at 6 AM PST:
 * 1. Scan portals for new Network Engineer jobs
 * 2. Evaluate each job (A-F scoring)
 * 3. Filter for 4.0+ matches
 * 4. Draft applications
 * 5. Add to applications.md
 *
 * Usage: node batch/daily-scan-evaluate-draft.mjs
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { Anthropic } from '@anthropic-ai/sdk';

const client = new Anthropic();
const DRAFTS_DIR = 'batch/application-drafts';
const MAX_CONCURRENT_EVALS = 3;

// Ensure drafts directory exists
if (!existsSync(DRAFTS_DIR)) {
  mkdirSync(DRAFTS_DIR, { recursive: true });
}

console.log('🌅 Daily Scan + Evaluate + Draft\n');

/**
 * Step 1: Scan portals for new jobs
 */
async function scanPortals() {
  console.log('📡 Scanning portals for Network Engineer jobs...');

  try {
    const result = execSync('node scan.mjs --json 2>/dev/null || echo "[]"', {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    const jobs = JSON.parse(result || '[]');
    console.log(`✅ Found ${jobs.length} job(s)\n`);
    return jobs;
  } catch (err) {
    console.error('⚠️ Scan failed:', err.message);
    return [];
  }
}

/**
 * Step 2: Check which jobs we've already applied to
 */
function getAppliedJobs() {
  try {
    const content = readFileSync('data/applications.md', 'utf8');
    const lines = content.split('\n');
    const applied = new Set();

    for (const line of lines) {
      if (line.startsWith('|') && !line.includes('Company')) {
        const cells = line.split('|');
        if (cells.length > 2) {
          const company = cells[2].trim();
          applied.add(company.toLowerCase());
        }
      }
    }

    return applied;
  } catch {
    return new Set();
  }
}

/**
 * Step 3: Load context (CV, profile, modes)
 */
function loadContext() {
  const cv = readFileSync('cv.md', 'utf8');
  const profile = readFileSync('config/profile.yml', 'utf8');
  const shared = readFileSync('modes/_shared.md', 'utf8');
  const userProfile = readFileSync('modes/_profile.md', 'utf8');

  return { cv, profile, shared, userProfile };
}

/**
 * Step 4: Evaluate a job using Claude
 */
async function evaluateJob(job, context) {
  const prompt = `You are a career advisor evaluating a job posting for a Network Engineer.

## Candidate Profile
${context.profile}

## Candidate CV
${context.cv}

## Evaluation Framework
${context.shared}

## User Customization
${context.userProfile}

## Job Posting
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || 'Not specified'}
Description: ${job.description}

Please evaluate this job on a scale of 1-5 across these dimensions:
- A (Match with CV): How well does the candidate's experience match?
- B (North Star alignment): Does this match target archetypes?
- C (Comp): Is salary competitive?
- D (Cultural signals): Is the company a good fit?
- E (Red flags): Any concerns?

Return ONLY valid JSON (no markdown):
{
  "title": "job title",
  "company": "company name",
  "location": "location",
  "score_a": 4.5,
  "score_b": 4.2,
  "score_c": 4.0,
  "score_d": 4.3,
  "score_e": 4.1,
  "global_score": 4.2,
  "match_summary": "Brief explanation of why this matches",
  "key_strengths": "What you bring to this role",
  "gaps": "Any skill gaps and how to address them"
}`;

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`  ❌ Failed to parse evaluation for ${job.company}`);
      return null;
    }

    const evaluation = JSON.parse(jsonMatch[0]);
    evaluation.global_score = parseFloat(evaluation.global_score);
    return evaluation;
  } catch (err) {
    console.error(`  ❌ Evaluation error for ${job.company}:`, err.message);
    return null;
  }
}

/**
 * Step 5: Draft application for high-scoring jobs
 */
async function draftApplication(job, evaluation, context) {
  const prompt = `You are drafting an application response for a Network Engineer role.

## Candidate Profile
${context.profile}

## Candidate CV
${context.cv}

## Job Details
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}

## Evaluation
Score: ${evaluation.global_score}/5
Match: ${evaluation.match_summary}

## Your Task
Draft a concise, professional application response that:
1. References specific skills from the job posting
2. Highlights relevant experience from the CV
3. Shows enthusiasm for the company
4. Is ready for copy-paste into an application form

Return ONLY the draft text (no markdown, no JSON):`;

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    return response.content[0].type === 'text' ? response.content[0].text : '';
  } catch (err) {
    console.error(`  ❌ Draft error for ${job.company}:`, err.message);
    return '';
  }
}

/**
 * Step 6: Save draft to file
 */
function saveDraft(job, evaluation, draftText) {
  const slug = job.company.toLowerCase().replace(/\s+/g, '-');
  const filename = `${slug}-${new Date().toISOString().split('T')[0]}.md`;
  const filepath = join(DRAFTS_DIR, filename);

  const content = `# ${job.title} at ${job.company}

**Date:** ${new Date().toISOString().split('T')[0]}
**Score:** ${evaluation.global_score}/5
**Location:** ${job.location || 'Not specified'}

## Evaluation
- Match with CV: ${evaluation.score_a}/5
- North Star alignment: ${evaluation.score_b}/5
- Compensation: ${evaluation.score_c}/5
- Culture: ${evaluation.score_d}/5
- Red flags: ${evaluation.score_e}/5

**Summary:** ${evaluation.match_summary}

**Your Strengths:** ${evaluation.key_strengths}

**Potential Gaps:** ${evaluation.gaps}

---

## Application Draft

\`\`\`
${draftText}
\`\`\`

---

**Next Step:** Review this draft and copy-paste into the application form at ${job.url || '(link not available)'}
`;

  writeFileSync(filepath, content);
  return filepath;
}

/**
 * Step 7: Add to applications.md
 */
function addToTracker(job, evaluation) {
  const date = new Date().toISOString().split('T')[0];
  const slug = job.company.toLowerCase().replace(/\s+/g, '-');
  const reportFile = `[draft-${date}](../batch/application-drafts/${slug}-${date}.md)`;

  const row = `| ${job.company} | ${job.title} | ${evaluation.global_score}/5 | Draft | ❌ | ${reportFile} | Ready to submit |`;

  try {
    let content = readFileSync('data/applications.md', 'utf8');

    // Check if already exists
    if (content.includes(job.company) && content.includes(job.title)) {
      console.log(`  ⏭️ ${job.company} - ${job.title} (already tracked)`);
      return false;
    }

    // Append row
    content += `\n${row}`;
    writeFileSync('data/applications.md', content);
    return true;
  } catch (err) {
    console.error(`  ❌ Failed to add to tracker:`, err.message);
    return false;
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    // Load context once
    const context = loadContext();
    const appliedJobs = getAppliedJobs();

    // Scan for jobs
    const jobs = await scanPortals();
    if (jobs.length === 0) {
      console.log('ℹ️ No new jobs found. Check back tomorrow!\n');
      return;
    }

    // Filter out already applied
    const newJobs = jobs.filter(j => !appliedJobs.has(j.company.toLowerCase()));
    console.log(`📋 ${newJobs.length} new job(s) to evaluate\n`);

    if (newJobs.length === 0) {
      console.log('✨ All jobs already tracked!\n');
      return;
    }

    // Evaluate jobs (with concurrency control)
    const highScoringJobs = [];
    for (let i = 0; i < newJobs.length; i += MAX_CONCURRENT_EVALS) {
      const batch = newJobs.slice(i, i + MAX_CONCURRENT_EVALS);
      const results = await Promise.all(
        batch.map(job => evaluateJob(job, context))
      );

      for (let j = 0; j < batch.length; j++) {
        const evaluation = results[j];
        if (evaluation && evaluation.global_score >= 4.0) {
          highScoringJobs.push({ job: batch[j], evaluation });
          console.log(`✅ ${batch[j].company} - ${batch[j].title}: ${evaluation.global_score}/5`);
        } else {
          console.log(`⏭️ ${batch[j].company} - ${batch[j].title}: ${evaluation?.global_score || 'N/A'}/5 (below threshold)`);
        }
      }
    }

    console.log(`\n📝 Drafting ${highScoringJobs.length} application(s)...\n`);

    // Draft applications for high-scoring jobs
    let draftCount = 0;
    for (const { job, evaluation } of highScoringJobs) {
      const draftText = await draftApplication(job, evaluation, context);
      if (draftText) {
        saveDraft(job, evaluation, draftText);
        addToTracker(job, evaluation);
        draftCount++;
        console.log(`📄 Drafted: ${job.company} - ${job.title}`);
      }
    }

    console.log(`\n✨ Complete! ${draftCount} application(s) ready for review.\n`);
    console.log('📍 Find drafts in: batch/application-drafts/\n');

  } catch (err) {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
  }
}

main();
