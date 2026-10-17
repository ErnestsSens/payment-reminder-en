# payment-reminder

Automated overdue-invoice control flow: reads overdue invoices from Google Sheets
(sheet `Invoices`), sends SMS reminders to clients via Text2Reach according
to an escalation schedule, and after three reminders notifies colleagues in a
Discord channel. When an invoice disappears from the list (paid), the case closes
automatically.

Practical guide for staff:
[Monitoring overdue invoices in Google Sheets](docs/google-sheets-user-guide.md).

## Flow

```
Invoice overdue ≥1 day       → SMS1 (friendly reminder)
2 days after SMS1            → SMS2 (firmer)
3 days after SMS2            → SMS3 (final reminder)
1 day after SMS3             → 📞 one-time escalation to the collection team
Overdue day 10               → 🔴 Discord notification to management
every 7 days                 → 🔴 repeated management notification
invoice disappears from list → ✅ status PAID, Discord notification (if the client was contacted)
```

If the team escalation was not sent successfully, the team also receives the
day-10 management notification. If the team has already been informed, further
management notifications are not sent to it.

Schedule and company configuration: [src/config.js](src/config.js). Discord
recipient IDs are stored in `.env` so that personal identifiers don't end up in
a public repository.

## Statuses (sheet `Reminders`, column F)

`NEW → REMINDER_1_SENT → REMINDER_2_SENT → REMINDER_3_SENT → CALL_REQUIRED → PAID`

This technical status is managed by the program only. The script automatically
creates two sheets:

- **Reminders** — one row per invoice: status, SMS dates, phone number.
  Columns intended for colleagues:
  - **Case Status** (K) — strict dropdown with the human workflow status;
  - **Call Result** (L) and **Notes** (M) — free text
    (reached, promised to pay, call back, etc.).
  - **Review Date** (O) — required date for the statuses
    “Payment promised”, “In collection”, “Disputed” and “Payment plan agreed”.
  - **Management Discord Date** (P) — date of the last successful management
    notification; managed by the program.
- **History** — full log: what, when, to which number, whether it
  succeeded, next check.

Available case statuses (dropdown values):

- `Contact client`;
- `Payment promised`;
- `In collection`;
- `Disputed`;
- `Payment plan agreed`;
- `Written off`;
- `Cancelled`.

`Written off` and `Cancelled` stop the automation completely. Statuses with a
required review date postpone notifications until that date. If the date is not
filled in, the case is not silently paused — a warning is shown in the weekly
notification.

## Safeguards

- SMS are never duplicated — the state machine is based on stored dates, not on
  overdue days (even on the first run, long-overdue invoices only get SMS1);
- if a document number repeats in the source sheet, only the first valid row is
  processed and a warning is logged;
- no SMS is sent without a valid phone number — colleagues get a Discord message
  immediately instead;
- the collection team escalation is sent once;
- for unresolved cases the management notification repeats after the configured
  interval;
- the management notification does not disturb the team if the team escalation
  has already gone out;
- an invalid case status or a missing required date does not stop reminders;
- every action is recorded in the `History` sheet.

## Setup

```bash
npm install
cp .env.example .env   # fill in the values
```

1. **Google:** set `GOOGLE_CREDENTIALS` to the full path of the service account
   JSON file, e.g. `/Users/username/secrets/service-account.json`. On the
   spreadsheet: **Share → service account email → Editor**.
2. **SPREADSHEET_ID** — from the file URL (`docs.google.com/spreadsheets/d/<ID>/edit`).
3. **TEXT2REACH_KEY**, **DISCORD_BOT_URL**, **DISCORD_BOT_KEY** — same as in the
   gunsnlasers-keystone project.
4. Put the Discord recipients in `.env` as comma-separated IDs:

   ```env
   JUGLA_MANAGER_DISCORD_IDS=jugla_manager_id
   MEZAPARKS_MANAGER_DISCORD_IDS=mezaparks_manager_id
   SAMPETERIS_MANAGER_DISCORD_IDS=sampeteris_manager_id
   GALERIJA_CENTRS_MANAGER_DISCORD_IDS=galerija_manager_id
   GNL_MANAGER_DISCORD_IDS=gnl_responsible_id
   FINANCE_DISCORD_IDS=finance_id
   MANAGEMENT_DISCORD_IDS=management_id
   ```

   The park ID is chosen from the document number prefix: `GLJ` → Jugla,
   `GLM` → Mežaparks, `GLŠ`/`GLS` → Šampēteris, `GLG` → Galerija Centrs and
   `GNL` → GNL (Jugla, Mežaparks, Šampēteris and Galerija Centrs are park
   locations in Riga; `GLS` is accepted as an ASCII alias for `GLŠ`).
   `FINANCE_DISCORD_IDS` additionally receives all operational
   collection messages. `MANAGEMENT_DISCORD_IDS` receives the overdue-day-10
   notification and the subsequent management notifications.

## Running and testing

```bash
# Automated tests:
npm test

# 1. Trial run — only prints what it would do; sends and writes nothing:
npm run dry-run

# 2. Full cycle with mocked sending (writes to the sheet, but SMS/Discord only to the console):
SMS_MOCK=true DISCORD_MOCK_MESSAGES=true npm start

# 3. Real mode:
npm start
```

Recommendation for the first real test: add a test row to the sheet with your
own phone number and make sure that (a) the SMS arrives, (b) running again on
the same day sends nothing.

## Cron (on an Ubuntu server)

The production run script automatically:

- prevents two runs from overlapping;
- fetches the latest `origin/main` with a safe fast-forward;
- runs `npm ci` if `package-lock.json` has changed;
- runs the automated tests and stops if any of them fail;
- runs `src/index.js`.

After cloning the project, make the script executable once:

```bash
chmod +x run-production.sh
```

Create a global command that can be called from any directory:

```bash
sudo ln -s /home/ernests/payment-reminder/run-production.sh /usr/local/bin/payment-reminder-run
```

Run a production cycle manually from any directory:

```bash
payment-reminder-run
```

For automatic runs:

```bash
crontab -e
```

```cron
# Every weekday at 10:00 Riga (Latvia) time
CRON_TZ=Europe/Riga
0 10 * * 1-5 /usr/local/bin/payment-reminder-run >> /home/ernests/payment-reminder/logs/run.log 2>&1
```

(`mkdir logs` before the first run; if an older cron doesn't support `CRON_TZ`,
adjust the hour to the server's time zone.)



---

## Testing the program

The safest way to test is with a separate copy of the Google Spreadsheet, so
production data isn't changed and no accidental SMS are sent.

### 1. Preparing the test environment

Create a `.env` file:

```bash
cp .env.example .env
```

Fill in at least these values:

```env
GOOGLE_CREDENTIALS=/full/path/service-account.json
SPREADSHEET_ID=test_spreadsheet_id

SMS_MOCK=true
DISCORD_MOCK_MESSAGES=true
```

Give the service account email `Editor` access to the test Google Spreadsheet.

In the `Invoices` sheet, starting from row 5, add a test invoice:

| Column | Value |
|---|---|
| C | `Test client` |
| D | `GLJ_TEST_001` |
| G | `10.00` |
| H | yesterday's date, e.g. `2026-08-04` |
| J | your own valid phone number |

The columns that matter to the program are C, D, G, H and J.

### 2. Dry-run check

To see what the program would do without sending or changing anything:

```bash
npm run dry-run
```

Dry-run mode:

- reads the Google Spreadsheet;
- shows the planned actions in the terminal;
- does not send SMS;
- does not send Discord messages;
- does not write changes to the spreadsheet.

You should see something like:

```text
📱 GLJ_TEST_001 (Test client) — SMS1 to +371...
```

### 3. Full-cycle test with mocked SMS

Run the program with SMS and Discord mock mode enabled:

```bash
SMS_MOCK=true DISCORD_MOCK_MESSAGES=true npm start
```

In this mode the program:

- does not send a real SMS;
- does not send a real Discord message;
- prints the mocked messages to the terminal;
- writes statuses to the test spreadsheet;
- automatically creates the `Reminders` and `History` sheets.

The terminal output will look roughly like this:

```text
[SMS MOCK] → +371...: This is a reminder that invoice...
SMS1 sent: GLJ_TEST_001 → +371...
```

In the `Reminders` sheet the status should become:

```text
REMINDER_1_SENT
```

Running the program again on the same day must not repeat SMS1.

### 4. Checking SMS2 without waiting

To avoid waiting the number of days set in the configuration, manually set in
the test `Reminders` sheet:

```text
Status: REMINDER_1_SENT
SMS1 Date: a date at least secondSmsAfterDays days ago
```

For example, if the configuration has:

```js
secondSmsAfterDays: 2
```

set the SMS1 date to at least two days ago.

Then run:

```bash
SMS_MOCK=true DISCORD_MOCK_MESSAGES=true npm start
```

The terminal should show the mocked SMS2, and the status should become:

```text
REMINDER_2_SENT
```

### 5. Checking SMS3 without waiting

In the test `Reminders` sheet, manually set:

```text
Status: REMINDER_2_SENT
SMS2 Date: a date at least thirdSmsAfterDays days ago
```

For example, if the configuration has:

```js
thirdSmsAfterDays: 3
```

set the SMS2 date to at least three days ago.

Run:

```bash
SMS_MOCK=true DISCORD_MOCK_MESSAGES=true npm start
```

The terminal should show the mocked SMS3, and the status should become:

```text
REMINDER_3_SENT
```

### 6. Checking team and management Discord notifications

In the test `Reminders` sheet, set:

```text
Status: REMINDER_3_SENT
SMS3 Date: a date at least teamEscalationAfterSms3Days days ago
```

For the team escalation to run, `.env` must contain at least one team Discord
ID. Management notifications use a separate ID:

```env
JUGLA_MANAGER_DISCORD_IDS=TEST_JUGLA_MANAGER_ID
MEZAPARKS_MANAGER_DISCORD_IDS=TEST_MEZAPARKS_MANAGER_ID
SAMPETERIS_MANAGER_DISCORD_IDS=TEST_SAMPETERIS_MANAGER_ID
GALERIJA_CENTRS_MANAGER_DISCORD_IDS=TEST_GALERIJA_MANAGER_ID
GNL_MANAGER_DISCORD_IDS=TEST_GNL_RESPONSIBLE_ID
FINANCE_DISCORD_IDS=TEST_FINANCE_ID
MANAGEMENT_DISCORD_IDS=TEST_MANAGEMENT_ID
```

Run the program in mock mode:

```bash
SMS_MOCK=true DISCORD_MOCK_MESSAGES=true npm start
```

The terminal should show:

```text
[DISCORD MOCK] → TEST_JUGLA_MANAGER_ID:
📞 The team needs to contact the client...
```

In the `Reminders` sheet the status should become:

```text
CALL_REQUIRED
```

To test the first management notification, additionally set the invoice due
date to at least `managerNotificationAfterDueDays` days ago. Leave
`Team Discord Date` filled in — then the management
message won't be sent to the team again.

To test the repeated management notification, set:

```text
Status: CALL_REQUIRED
Management Discord Date: a date at least managerRepeatAfterDays days ago
```

After the next run, the management Discord mock notification should appear
again, and `Management Discord Date` should be updated to today.

### 7. Testing one real SMS

Do this step only after the mock-mode checks have passed.

1. Set your own phone number on the test invoice.
2. Put a valid `TEXT2REACH_KEY` in `.env`.
3. Keep Discord in mock mode.
4. Turn off SMS mock mode:

```env
SMS_MOCK=false
DISCORD_MOCK_MESSAGES=true
```

5. Create a new test invoice with a new document number.
6. Run:

```bash
npm start
```

If you reuse an already processed document number, the program will assume the
corresponding SMS step has already been done.

### Recommended testing order

1. `npm run dry-run`
2. SMS1 mock test
3. run again, checking that SMS1 is not duplicated
4. SMS2 mock test
5. SMS3 mock test
6. Discord escalation mock test
7. one real SMS to your own phone number
8. only then connect the production spreadsheet
