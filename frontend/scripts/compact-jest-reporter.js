'use strict';

const MAX_MESSAGE_LINES = 8;
const MAX_LINE_LENGTH = 240;

function compactFailureMessage(message) {
  const lines = String(message || '')
    .split(/\r?\n/)
    .map((line) => line.length > MAX_LINE_LENGTH
      ? `${line.slice(0, MAX_LINE_LENGTH)}… [${line.length - MAX_LINE_LENGTH} characters omitted]`
      : line);
  const location = lines.find((line) => /\bat .+\.(?:js|jsx|ts|tsx):\d+:\d+\)?$/.test(line));
  const excerpt = lines.slice(0, MAX_MESSAGE_LINES);

  if (lines.length > MAX_MESSAGE_LINES) {
    excerpt.push(`    … ${lines.length - MAX_MESSAGE_LINES} lines omitted; rerun with --verbose for full output`);
  }
  if (location && !excerpt.includes(location)) excerpt.push(location);
  return excerpt.join('\n').trimEnd();
}

class CompactJestReporter {
  onTestResult(_test, testResult) {
    const failures = testResult.testResults.filter((result) => result.status === 'failed');
    if (failures.length === 0) return;

    process.stderr.write(`FAIL ${testResult.testFilePath}\n`);
    failures.forEach((failure) => {
      process.stderr.write(`  ✕ ${failure.fullName}\n`);
      failure.failureMessages.forEach((message) => {
        process.stderr.write(`${compactFailureMessage(message)}\n`);
      });
    });
  }

  onRunComplete(_contexts, results) {
    const passed = results.numPassedTestSuites;
    const failed = results.numFailedTestSuites;
    const pending = results.numPendingTestSuites;
    process.stdout.write(
      `Test Suites: ${failed} failed, ${passed} passed, ${pending} skipped, ${results.numTotalTestSuites} total\n`
      + `Tests:       ${results.numFailedTests} failed, ${results.numPassedTests} passed, `
      + `${results.numPendingTests} skipped, ${results.numTotalTests} total\n`,
    );
  }
}

module.exports = CompactJestReporter;
module.exports.compactFailureMessage = compactFailureMessage;
