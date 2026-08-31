const config = require('../config');

function money(n) {
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/** First-touch introduction message. */
function introMessage({ leadName, building, price }) {
  const greeting = leadName ? `Hi ${leadName},` : 'Hi,';
  return (
    `${greeting} this is ${config.company.name}. We have clearance materials/rights available at ` +
    `${building.name}${building.address ? ` (${building.address})` : ''}. ` +
    `${building.details ? building.details + ' ' : ''}` +
    `Asking ${money(price)}. Interested? Reply YES for details or STOP to opt out. ` +
    `- ${config.company.name}, ${config.company.phone}`
  );
}

/** Daily "auction-style" follow-up, phrased as a question. */
function followUpMessage({ leadName, building, price, atFloor }) {
  const greeting = leadName ? `Hi ${leadName},` : 'Hi,';
  if (atFloor) {
    return (
      `${greeting} following up on ${building.name} — our best and final is ${money(price)}. ` +
      `Would you like to move forward at this price? Reply YES to lock it in or STOP to opt out.`
    );
  }
  return (
    `${greeting} checking back on ${building.name} — would you take it at ${money(price)}? ` +
    `Reply with a number that works for you, YES to accept, or STOP to opt out.`
  );
}

/** Email subject/body variants of the same two templates. */
function introEmail({ leadName, building, price }) {
  const greeting = leadName ? `Hi ${leadName},` : 'Hi,';
  return {
    subject: `Clearance opportunity: ${building.name}`,
    text:
      `${greeting}\n\n` +
      `This is ${config.company.name}. We have clearance materials/rights available at ` +
      `${building.name}${building.address ? ` (${building.address})` : ''}.\n\n` +
      `${building.details ? building.details + '\n\n' : ''}` +
      `Asking price: ${money(price)}.\n\n` +
      `Reply to this email if you're interested, or let us know if you'd like to be removed from our list.\n\n` +
      `${config.company.name}\n${config.company.phone}`,
  };
}

function followUpEmail({ leadName, building, price, atFloor }) {
  const greeting = leadName ? `Hi ${leadName},` : 'Hi,';
  return {
    subject: `Following up: ${building.name}`,
    text: atFloor
      ? `${greeting}\n\nFollowing up on ${building.name} — our best and final price is ${money(price)}. ` +
        `Let us know if you'd like to move forward, or reply to opt out.\n\n${config.company.name}\n${config.company.phone}`
      : `${greeting}\n\nChecking back on ${building.name} — would you take it at ${money(price)}? ` +
        `Reply with a number that works, or let us know if you'd like to opt out.\n\n${config.company.name}\n${config.company.phone}`,
  };
}

module.exports = { money, introMessage, followUpMessage, introEmail, followUpEmail };
