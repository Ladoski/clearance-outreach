const config = require('../config');

/**
 * Computes the floor price for a lead: uses the building's explicit
 * floor_price if set, otherwise a percentage of the building's initial ask.
 */
function computeFloor({ initialPrice, buildingFloorPrice }) {
  if (buildingFloorPrice != null) return Number(buildingFloorPrice);
  const pct = config.pricing.floorPercentOfAsk / 100;
  return Number(initialPrice) * pct;
}

/**
 * Given the lead's current state, returns the NEXT price to offer.
 * This is intentionally the only place pricing math happens — change
 * PRICING_STRATEGY (and related env vars) in .env and nothing else
 * in the app needs to change.
 *
 * @param {Object} lead
 * @param {number} lead.currentPrice - last price quoted (or initial price if day_count === 0)
 * @param {number} lead.initialPrice - the building's starting ask
 * @param {number|null} lead.buildingFloorPrice - optional hard floor from the building record
 * @param {number} lead.dayCount - how many outreach rounds have gone out
 * @returns {{ nextPrice: number, floor: number, atFloor: boolean }}
 */
function computeNextPrice(lead) {
  const floor = computeFloor(lead);
  const strategy = config.pricing.strategy;

  let nextPrice;
  if (lead.dayCount === 0) {
    // First message: quote the asking price, no reduction yet.
    nextPrice = Number(lead.initialPrice);
  } else if (strategy === 'percent') {
    const factor = 1 - config.pricing.percentPerDay / 100;
    nextPrice = Number(lead.currentPrice) * factor;
  } else if (strategy === 'fixed') {
    nextPrice = Number(lead.currentPrice) - config.pricing.fixedPerDay;
  } else {
    // 'manual' strategy: don't auto-change the price; caller/admin sets it.
    nextPrice = Number(lead.currentPrice);
  }

  const atFloor = nextPrice <= floor;
  if (atFloor) nextPrice = floor;

  return { nextPrice: round2(nextPrice), floor: round2(floor), atFloor };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

module.exports = { computeNextPrice, computeFloor };
