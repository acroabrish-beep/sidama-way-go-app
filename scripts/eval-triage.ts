#!/usr/bin/env tsx
/**
 * Evaluation script for AI triage
 * Runs triageReport on test samples and generates accuracy metrics
 */

import { triageReport } from '../src/lib/ai/triage';
import { env } from '../src/lib/config/env';
import * as fs from 'fs';
import * as path from 'path';

interface TestSample {
  id: number;
  description: string;
  category: string;
  expectedCategory: string;
  expectedUrgency: string;
  language: string;
}

interface TestSet {
  note: string;
  samples: TestSample[];
}

interface EvalResult {
  id: number;
  description: string;
  expectedCategory: string;
  expectedUrgency: string;
  actualCategory: string | null;
  actualUrgency: string | null;
  confidence: number | null;
  language: string;
  categoryMatch: boolean;
  urgencyMatch: boolean;
  error?: string;
}

interface Metrics {
  total: number;
  successful: number;
  failed: number;
  categoryAccuracy: number;
  urgencyAccuracy: number;
  averageConfidence: number;
  accuracyByCategory: Record<string, { correct: number; total: number; accuracy: number }>;
  accuracyByLanguage: Record<string, { correct: number; total: number; accuracy: number }>;
  wrongAnswers: EvalResult[];
}

async function main() {
  console.log('=== AI Triage Evaluation ===\n');

  // Check if API key is configured
  if (!env.geminiApiKey) {
    console.log('GEMINI_API_KEY is not configured. Skipping evaluation.');
    console.log('Set GEMINI_API_KEY environment variable to run the evaluation.');
    process.exit(0);
  }

  // Load test data
  const testSetPath = path.join(__dirname, '../eval/triage-testset.json');
  if (!fs.existsSync(testSetPath)) {
    console.error(`Test set not found: ${testSetPath}`);
    process.exit(1);
  }

  const testSet: TestSet = JSON.parse(fs.readFileSync(testSetPath, 'utf-8'));
  console.log(`Loaded ${testSet.samples.length} test samples\n`);

  // Run triage on each sample
  const results: EvalResult[] = [];
  
  for (const sample of testSet.samples) {
    console.log(`Processing sample ${sample.id} (${sample.language})...`);
    
    try {
      const triageResult = await triageReport({
        description: sample.description,
        category: sample.category,
      });

      if (!triageResult) {
        results.push({
          id: sample.id,
          description: sample.description,
          expectedCategory: sample.expectedCategory,
          expectedUrgency: sample.expectedUrgency,
          actualCategory: null,
          actualUrgency: null,
          confidence: null,
          language: sample.language,
          categoryMatch: false,
          urgencyMatch: false,
          error: 'Triage returned null',
        });
        console.log(`  -> FAILED (null result)\n`);
        continue;
      }

      const categoryMatch = triageResult.category === sample.expectedCategory;
      const urgencyMatch = triageResult.urgency === sample.expectedUrgency;

      results.push({
        id: sample.id,
        description: sample.description,
        expectedCategory: sample.expectedCategory,
        expectedUrgency: sample.expectedUrgency,
        actualCategory: triageResult.category,
        actualUrgency: triageResult.urgency,
        confidence: triageResult.confidence,
        language: sample.language,
        categoryMatch,
        urgencyMatch,
      });

      const status = categoryMatch && urgencyMatch ? '✓' : (categoryMatch ? '~' : '✗');
      console.log(`  -> ${status} cat:${triageResult.category} urg:${triageResult.urgency} conf:${triageResult.confidence.toFixed(2)}\n`);

    } catch (error) {
      results.push({
        id: sample.id,
        description: sample.description,
        expectedCategory: sample.expectedCategory,
        expectedUrgency: sample.expectedUrgency,
        actualCategory: null,
        actualUrgency: null,
        confidence: null,
        language: sample.language,
        categoryMatch: false,
        urgencyMatch: false,
        error: error instanceof Error ? error.message : String(error),
      });
      console.log(`  -> ERROR: ${error}\n`);
    }
  }

  // Calculate metrics
  const metrics = calculateMetrics(results);

  // Write results
  const resultsPath = path.join(__dirname, '../eval/results.json');
  fs.writeFileSync(resultsPath, JSON.stringify({ results, metrics }, null, 2));
  console.log(`Results written to: ${resultsPath}`);

  // Write markdown report
  const reportPath = path.join(__dirname, '../eval/results.md');
  fs.writeFileSync(reportPath, generateMarkdownReport(metrics, results));
  console.log(`Report written to: ${reportPath}`);

  // Print summary
  console.log('\n=== Evaluation Summary ===');
  console.log(`Total samples: ${metrics.total}`);
  console.log(`Successful: ${metrics.successful} (${(metrics.successful / metrics.total * 100).toFixed(1)}%)`);
  console.log(`Failed: ${metrics.failed} (${(metrics.failed / metrics.total * 100).toFixed(1)}%)`);
  console.log(`Category accuracy: ${(metrics.categoryAccuracy * 100).toFixed(1)}%`);
  console.log(`Urgency accuracy: ${(metrics.urgencyAccuracy * 100).toFixed(1)}%`);
  console.log(`Average confidence: ${metrics.averageConfidence.toFixed(2)}`);
  console.log('\nAccuracy by category:');
  for (const [cat, data] of Object.entries(metrics.accuracyByCategory)) {
    console.log(`  ${cat}: ${(data.accuracy * 100).toFixed(1)}% (${data.correct}/${data.total})`);
  }
  console.log('\nAccuracy by language:');
  for (const [lang, data] of Object.entries(metrics.accuracyByLanguage)) {
    console.log(`  ${lang}: ${(data.accuracy * 100).toFixed(1)}% (${data.correct}/${data.total})`);
  }
}

function calculateMetrics(results: EvalResult[]): Metrics {
  const total = results.length;
  const successful = results.filter(r => !r.error).length;
  const failed = results.filter(r => r.error).length;

  const categoryCorrect = results.filter(r => r.categoryMatch).length;
  const urgencyCorrect = results.filter(r => r.urgencyMatch).length;

  const categoryAccuracy = total > 0 ? categoryCorrect / total : 0;
  const urgencyAccuracy = total > 0 ? urgencyCorrect / total : 0;

  const confidenceValues = results.filter(r => r.confidence !== null).map(r => r.confidence!);
  const averageConfidence = confidenceValues.length > 0
    ? confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length
    : 0;

  // Accuracy by category
  const accuracyByCategory: Record<string, { correct: number; total: number; accuracy: number }> = {};
  results.forEach(r => {
    if (!accuracyByCategory[r.expectedCategory]) {
      accuracyByCategory[r.expectedCategory] = { correct: 0, total: 0, accuracy: 0 };
    }
    accuracyByCategory[r.expectedCategory].total++;
    if (r.categoryMatch) {
      accuracyByCategory[r.expectedCategory].correct++;
    }
  });
  for (const cat in accuracyByCategory) {
    accuracyByCategory[cat].accuracy = accuracyByCategory[cat].correct / accuracyByCategory[cat].total;
  }

  // Accuracy by language
  const accuracyByLanguage: Record<string, { correct: number; total: number; accuracy: number }> = {};
  results.forEach(r => {
    if (!accuracyByLanguage[r.language]) {
      accuracyByLanguage[r.language] = { correct: 0, total: 0, accuracy: 0 };
    }
    accuracyByLanguage[r.language].total++;
    if (r.categoryMatch) {
      accuracyByLanguage[r.language].correct++;
    }
  });
  for (const lang in accuracyByLanguage) {
    accuracyByLanguage[lang].accuracy = accuracyByLanguage[lang].correct / accuracyByLanguage[lang].total;
  }

  const wrongAnswers = results.filter(r => !r.categoryMatch || !r.urgencyMatch || r.error);

  return {
    total,
    successful,
    failed,
    categoryAccuracy,
    urgencyAccuracy,
    averageConfidence,
    accuracyByCategory,
    accuracyByLanguage,
    wrongAnswers,
  };
}

function generateMarkdownReport(metrics: Metrics, results: EvalResult[]): string {
  let md = '# AI Triage Evaluation Report\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;

  md += '## Summary\n\n';
  md += `- Total samples: ${metrics.total}\n`;
  md += `- Successful: ${metrics.successful} (${(metrics.successful / metrics.total * 100).toFixed(1)}%)\n`;
  md += `- Failed: ${metrics.failed} (${(metrics.failed / metrics.total * 100).toFixed(1)}%)\n`;
  md += `- Category accuracy: ${(metrics.categoryAccuracy * 100).toFixed(1)}%\n`;
  md += `- Urgency accuracy: ${(metrics.urgencyAccuracy * 100).toFixed(1)}%\n`;
  md += `- Average confidence: ${metrics.averageConfidence.toFixed(2)}\n\n`;

  md += '## Accuracy by Category\n\n';
  md += '| Category | Accuracy | Correct/Total |\n';
  md += '|----------|----------|--------------|\n';
  for (const [cat, data] of Object.entries(metrics.accuracyByCategory)) {
    md += `| ${cat} | ${(data.accuracy * 100).toFixed(1)}% | ${data.correct}/${data.total} |\n`;
  }
  md += '\n';

  md += '## Accuracy by Language\n\n';
  md += '| Language | Accuracy | Correct/Total |\n';
  md += '|----------|----------|--------------|\n';
  for (const [lang, data] of Object.entries(metrics.accuracyByLanguage)) {
    md += `| ${lang} | ${(data.accuracy * 100).toFixed(1)}% | ${data.correct}/${data.total} |\n`;
  }
  md += '\n';

  md += '## Wrong Answers\n\n';
  if (metrics.wrongAnswers.length === 0) {
    md += 'No wrong answers.\n';
  } else {
    md += '| ID | Expected Cat | Actual Cat | Expected Urg | Actual Urg | Confidence | Error |\n';
    md += '|----|--------------|------------|-------------|------------|------------|-------|\n';
    for (const r of metrics.wrongAnswers) {
      const conf = r.confidence !== null ? r.confidence.toFixed(2) : 'N/A';
      md += `| ${r.id} | ${r.expectedCategory} | ${r.actualCategory || 'N/A'} | ${r.expectedUrgency} | ${r.actualUrgency || 'N/A'} | ${conf} | ${r.error || ''} |\n`;
    }
  }
  md += '\n';

  md += '---\n\n';
  md += '**Note:** Amharic and Sidaamu Afoo test samples are machine-written and MUST be reviewed by a native speaker before being quoted in any report.\n';

  return md;
}

main().catch(error => {
  console.error('Evaluation failed:', error);
  process.exit(1);
});
