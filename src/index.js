import 'dotenv/config';
import { runWorkflow } from './workflow.js';

runWorkflow({ dryRun: process.argv.includes('--dry-run') }).catch((error) => {
  console.error('Error:', error);
  process.exitCode = 1;
});
