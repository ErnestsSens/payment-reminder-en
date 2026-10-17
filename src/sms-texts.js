/**
 * SMS templates — plain ASCII so they safely fit the GSM-7 encoding
 * (Text2Reach 'txt' mode; special characters could turn the message into more
 * expensive UCS-2).
 */

function formatAmount(amount) {
  return amount.toFixed(2);
}

export function reminderText(step, { docNr, amount, dueDate }) {
  const total = formatAmount(amount);
  switch (step) {
    case 1:
      return (
        `This is a reminder that invoice ${docNr} for ${total} EUR was due on ${dueDate}. ` +
        `Please make the payment. If you have already paid, please disregard this message.`
      );
    case 2:
      return (
        `Second reminder: invoice ${docNr} for ${total} EUR is still unpaid. ` +
        `It was due on ${dueDate}. Please make the payment immediately. ` +
        `If you have already paid, please disregard this message.`
      );
    case 3:
      return (
        `FINAL REMINDER: invoice ${docNr} for ${total} EUR is still unpaid. ` +
        `It was due on ${dueDate}. If payment is not made, our representative will contact you. ` +
        `If you have already paid, please disregard this message.`
      );
    default:
      throw new Error(`Unknown SMS step: ${step}`);
  }
}
