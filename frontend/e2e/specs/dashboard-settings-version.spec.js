const { test, expect } = require('@playwright/test');

const commitSha = 'abc123def4567890abc123def4567890abc123de';
const appUrl = process.env.E2E_BASE_URL || '/';

function fulfillJson(route, body) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

test('shows GitLab commit SHA in dashboard settings', async ({ page }) => {
  await page.route('**/api/**', (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;

    if (path === '/api/users/me') {
      return fulfillJson(route, { email: 'version-viewer@example.com', groups: ['version-group'] });
    }
    if (path === '/api/users/me/groups') {
      return fulfillJson(route, ['version-group']);
    }
    if (path === '/api/projects/') {
      return fulfillJson(route, []);
    }
    if (path === '/api/dashboard/settings/version') {
      return fulfillJson(route, { gitlab_commit_sha: commitSha });
    }
    if (path === '/api/dashboard/settings/database-url') {
      return fulfillJson(route, { database_url: 'postgresql+asyncpg://user:pass@localhost:5432/vista' });
    }

    return fulfillJson(route, {});
  });

  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await expect(page.getByText('No projects yet')).toBeVisible();

  await page.getByRole('button', { name: 'Open dashboard settings' }).click();

  const modal = page.getByRole('dialog', { name: 'Dashboard Settings' });
  await expect(modal).toBeVisible();
  await expect(modal.getByText('Version Information')).toBeVisible();
  await expect(modal.getByText('GitLab Commit SHA')).toBeVisible();
  await expect(modal.getByText(commitSha)).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Copy SHA' })).toBeEnabled();
});
