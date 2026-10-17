import test from 'node:test';
import assert from 'node:assert/strict';
import { managementRecipientGroups } from '../src/notifications.js';

test('management notification does not include team after prior team escalation', () => {
  assert.deepEqual(
    managementRecipientGroups(['manager'], ['finance', 'park'], false),
    {
      managerIds: ['manager'],
      teamFallbackIds: [],
      teamIdsReachedViaManagement: [],
    },
  );
});

test('management notification also reaches team when fallback is required', () => {
  assert.deepEqual(
    managementRecipientGroups(
      ['manager', 'finance'],
      ['finance', 'park', 'park'],
      true,
    ),
    {
      managerIds: ['manager', 'finance'],
      teamFallbackIds: ['park'],
      teamIdsReachedViaManagement: ['finance'],
    },
  );
});
