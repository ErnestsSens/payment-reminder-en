# Overdue invoice monitoring guide

## How the program works

The program automatically:

1. Reads invoices from the `Invoices` sheet.
2. Sends up to three SMS reminders for overdue invoices.
3. If the invoice is still unpaid, informs the responsible park manager and the finance person.
4. On overdue day 10, informs management.
5. For unresolved cases, repeats the management notification after a set interval.
6. Records every action in the `History` sheet.

## Which columns may be filled in manually

In the `Reminders` sheet, these columns are meant for colleagues:

| Column | Name | What to enter |
|---|---|---|
| K | Case Status | Choose a status from the dropdown |
| L | Call Result | For example, “Reached, will pay on Friday” |
| M | Notes | Additional information about the client or situation |
| O | Review Date | The date when the invoice should be checked again |

The other columns are managed by the program and should not be changed manually.

## Available case statuses

| Status | When to use |
|---|---|
| `Contact client` | The client needs to be called or written to |
| `Payment promised` | The client has given a planned payment date |
| `In collection` | The invoice has been handed over for active debt collection |
| `Disputed` | The client disagrees with the invoice or amount |
| `Payment plan agreed` | A payment arrangement has been agreed |
| `Written off` | The invoice will no longer be collected |
| `Cancelled` | The invoice has been cancelled |

`Written off` and `Cancelled` are final statuses — the program will no longer send SMS or Discord notifications for that invoice.

## How to pause reminders until a specific date

1. In the **Case Status** column, choose one of these statuses:

   - `Payment promised`
   - `In collection`
   - `Disputed`
   - `Payment plan agreed`

2. In the **Review Date** column, enter a date.

Automatic SMS and management notifications will be paused until that date.

On the review date the program will remind you about the case again. If you need to wait longer, enter a new review date.

> Don't leave the required review date empty. Otherwise the program will keep sending periodic notifications and point out that the date is missing.

## When an invoice is marked as paid

An invoice automatically gets the technical status `PAID` when its document number can no longer be found in the `Invoices` sheet.

There is no need to record the payment manually in the `Reminders` sheet.

If an invoice has been paid but is still visible in `Invoices`, check the source data. As long as the document number is there, the program won't close the case automatically.

## Recommended workflow

1. When you receive a notification, open the invoice in the `Reminders` sheet.
2. Contact the client.
3. Fill in **Case Status**, **Call Result** and, if needed, **Notes**.
4. If payment or another action is expected later, enter a **Review Date**.
5. On the review date, check whether the invoice has been paid.
6. If it hasn't, update the information and set the next action or review date.
7. See the history of all automatic actions in the `History` sheet.

## Important

- Don't change the technical status `NEW`, `REMINDER_1_SENT`, `REMINDER_2_SENT`, `REMINDER_3_SENT`, `CALL_REQUIRED` or `PAID`.
- Don't delete rows from `Reminders`.
- Correct the phone number, invoice amount and due date in the source sheet `Invoices`.
- Always use a case status offered by the dropdown.
- Don't store passwords, access keys or other sensitive data in the notes.
