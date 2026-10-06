const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('node:crypto');

const app = express();
const port = process.env.PORT || 3000;
const fleetMeanBSM = 1.05;
const fleetVariance = 0.08;
const betweenRiderVariance = 0.04;
const credibilityK = fleetVariance / betweenRiderVariance;
const baseSwapPremium = 25;
const replacementCost = 85000;
const salvageRecovery = 15000;
const claimSeverity = replacementCost - salvageRecovery;
const startTime = Date.now();

app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(__dirname));

const riderAccounts = new Map();
const riderSessions = new Map();

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function calculateBSM({ dod, cellTemp, fastChargePct }) {
  const alpha = 1.50;
  const beta = 0.04;
  const gamma = 0.50;

  return Math.exp(
    alpha * Math.max(0, dod - 0.80) +
    beta * Math.max(0, cellTemp - 35) +
    gamma * fastChargePct
  );
}

function calculateCF({ harshEventsPer100km, weeklyKm }) {
  return Math.max(0.80, 1.0 + 0.025 * harshEventsPer100km + 0.0003 * (weeklyKm - 550));
}

function calculateCredibility(weeksActive) {
  return (weeksActive || 1) / ((weeksActive || 1) + credibilityK);
}

function calculateDynamicPremium({ bsm, cf, credibilityZ }) {
  const adjustedBSM = credibilityZ * bsm + (1 - credibilityZ) * fleetMeanBSM;
  return baseSwapPremium * adjustedBSM * (0.80 + 0.20 * cf);
}

function buildRiderProfile(data) {
  const rider = {
    riderId: data.riderId || data.packId || `RDR_${Math.floor(1000 + Math.random() * 9000)}`,
    packId: data.packId || `PK-${Math.floor(10000 + Math.random() * 90000)}`,
    phoneNumber: data.phoneNumber || `+254${Math.floor(700000000 + Math.random() * 10000000)}`,
    name: data.name || 'Unknown Rider',
    county: data.county || 'Nairobi',
    evModel: data.evModel || 'Bimavolt S2',
    tier: data.tier || 'Gold Tier',
    sohPct: data.sohPct ?? 91.5,
    dod: data.dod ?? 0.68,
    cellTemp: data.cellTemp ?? 33.6,
    fastChargePct: data.fastChargePct ?? 0.12,
    harshEventsPer100km: data.harshEventsPer100km ?? 2.4,
    weeklyKm: data.weeklyKm ?? 520,
    weeksActive: data.weeksActive ?? 8,
    active: data.active !== false,
    eligibleForMode2Replacement: data.eligibleForMode2Replacement ?? false,
    status: data.status || 'Active'
  };

  rider.bsm = calculateBSM(rider);
  rider.cf = calculateCF(rider);
  rider.credibilityZ = calculateCredibility(rider.weeksActive);
  rider.adjustedBSM = rider.credibilityZ * rider.bsm + (1 - rider.credibilityZ) * fleetMeanBSM;
  rider.premium = calculateDynamicPremium({
    bsm: rider.bsm,
    cf: rider.cf,
    credibilityZ: rider.credibilityZ
  });

  rider.riskScore = clamp(Math.round((rider.harshEventsPer100km * 6.5 + (rider.weeklyKm / 20) + (Math.max(0, rider.cellTemp - 35) * 8) + (rider.fastChargePct * 100 * 0.8))), 0, 100);
  rider.estimatedUsefulSwaps = Math.max(180, Math.round((rider.sohPct - 70) * 42));
  rider.claimToken = rider.sohPct < 70 ? 'BV-SWAP-99' : null;

  return rider;
}

const sampleProfiles = [
  {
    riderId: 'RDR_1068',
    packId: 'PK-10431',
    phoneNumber: '+254712345678',
    name: 'Juma Mwangi',
    county: 'Nairobi',
    evModel: 'Ampersand X',
    tier: 'Gold Tier',
    sohPct: 94.2,
    dod: 0.647,
    cellTemp: 33.5,
    fastChargePct: 0.12,
    harshEventsPer100km: 1.8,
    weeklyKm: 500,
    weeksActive: 12,
    active: true,
    eligibleForMode2Replacement: false,
    status: 'Healthy'
  },
  {
    riderId: 'RDR_1009',
    packId: 'PK-10988',
    phoneNumber: '+254798765432',
    name: 'Kevin Ochieng',
    county: 'Mombasa',
    evModel: 'Roam SR',
    tier: 'High-Stress',
    sohPct: 68.1,
    dod: 0.914,
    cellTemp: 41.4,
    fastChargePct: 0.69,
    harshEventsPer100km: 8.9,
    weeklyKm: 730,
    weeksActive: 8,
    active: true,
    eligibleForMode2Replacement: true,
    status: 'Eligible for Mode 2 Replacement'
  }
];

let riders = sampleProfiles.map(buildRiderProfile);

function getRiderByPhone(phoneNumber) {
  const normalized = phoneNumber?.toString().trim();
  return riders.find((rider) => rider.phoneNumber === normalized) || null;
}

function defaultRiderForPhone(phoneNumber) {
  const profile = buildRiderProfile({
    riderId: `RDR_${Math.floor(1000 + Math.random() * 9000)}`,
    packId: `PK-${Math.floor(10000 + Math.random() * 90000)}`,
    phoneNumber,
    name: 'Default Fleet Rider',
    county: 'Nakuru',
    evModel: 'BimaVolt City',
    tier: 'Standard',
    sohPct: 82.1,
    dod: 0.74,
    cellTemp: 36.9,
    fastChargePct: 0.33,
    harshEventsPer100km: 4.3,
    weeklyKm: 605,
    weeksActive: 5,
    active: true,
    eligibleForMode2Replacement: false,
    status: 'Active'
  });

  riders.push(profile);
  return profile;
}

function getUSSDOutput(phoneNumber, text) {
  const rider = getRiderByPhone(phoneNumber) || defaultRiderForPhone(phoneNumber);
  const segments = (text || '').split('*').filter((segment) => segment !== '');
  const first = segments[0] || '';
  const second = segments[1] || '';
  const third = segments[2] || '';

  if (!text || text === '') {
    return `CON Karibu BimaVolt Protection:\n1. Battery Health (SoH)\n2. Next Swap Rate & Micro-Premium\n3. Claim Battery Replacement\n4. Driving Safety & Credibility Score\n5. English / Kiswahili`;
  }

  if (first === '1') {
    if (segments.length <= 1) {
      return `CON Pack ID: ${rider.packId}\nSoH: ${rider.sohPct.toFixed(1)}%\nTier: ${rider.tier}\nUseful Swaps Remaining: ${rider.estimatedUsefulSwaps}\n0. Back`;
    }
    return `CON Pack ID: ${rider.packId}\nSoH: ${rider.sohPct.toFixed(1)}%\nTier: ${rider.tier}\nUseful Swaps Remaining: ${rider.estimatedUsefulSwaps}\n0. Back`;
  }

  if (first === '2') {
    const baseSwap = 250.0;
    const premium = rider.premium;
    const total = baseSwap + premium;
    return `CON Base Energy Swap: KES ${baseSwap.toFixed(2)}\nDynamic BimaVolt Premium: KES ${premium.toFixed(2)}\nTotal M-Pesa Payable: KES ${total.toFixed(2)}\nTip: Maintain DoD below 80% and avoid repeated fast charging.\n0. Back`;
  }

  if (first === '3') {
    if (second === '1') {
      return 'END Claim Approved. Present Token BV-SWAP-99 at Station.';
    }
    if (rider.sohPct < 70.0) {
      return `CON Alert: Pack degraded to ${rider.sohPct.toFixed(1)}% (<70% limit). Pre-approved for free replacement pack at station. 1. Confirm Token`;
    }
    return `END Pack healthy at ${rider.sohPct.toFixed(1)}%. Replacement threshold is <70%. No claim required.`;
  }

  if (first === '4') {
    if (segments.length <= 1) {
      return `CON Driver Risk Score: ${rider.riskScore}/100\nHarsh Events: ${rider.harshEventsPer100km.toFixed(1)}/100km\nCredibility: ${(rider.credibilityZ * 100).toFixed(1)}%\nWeekly Safety Bonus: KES ${(rider.premium * 0.12).toFixed(2)}\n0. Back`;
    }
    return `CON Driver Risk Score: ${rider.riskScore}/100\nHarsh Events: ${rider.harshEventsPer100km.toFixed(1)}/100km\nCredibility: ${(rider.credibilityZ * 100).toFixed(1)}%\nWeekly Safety Bonus: KES ${(rider.premium * 0.12).toFixed(2)}\n0. Back`;
  }

  if (first === '5') {
    return 'END BimaVolt supports English and Kiswahili. Use the menu to continue.';
  }

  return `END Invalid option. Please select a valid menu item.`;
}

app.get('/health', (req, res) => {
  const uptimeMs = Date.now() - startTime;
  res.json({
    ok: true,
    service: 'BimaVolt Kenya Core Platform',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Number((uptimeMs / 1000).toFixed(2)),
    uptimeMs
  });
});

app.get('/api/riders', (req, res) => {
  res.json(riders.map((rider) => ({
    riderId: rider.riderId,
    name: rider.name,
    phoneNumber: rider.phoneNumber,
    county: rider.county,
    evModel: rider.evModel,
    tier: rider.tier,
    active: rider.active,
    sohPct: rider.sohPct,
    dod: rider.dod,
    cellTemp: rider.cellTemp,
    fastChargePct: rider.fastChargePct,
    harshEventsPer100km: rider.harshEventsPer100km,
    weeklyKm: rider.weeklyKm,
    bsm: Number(rider.bsm.toFixed(3)),
    cf: Number(rider.cf.toFixed(3)),
    credibilityZ: Number(rider.credibilityZ.toFixed(3)),
    premium: Number(rider.premium.toFixed(2)),
    riskScore: rider.riskScore,
    status: rider.status,
    mode2Eligible: rider.eligibleForMode2Replacement
  })));
});

app.get('/api/batteries', (req, res) => {
  const batteries = riders.map((rider) => ({
    packId: rider.packId,
    riderId: rider.riderId,
    cycleCount: Math.max(180, Math.round(rider.weeklyKm * 2.4 + rider.weeksActive * 55)),
    sohPct: rider.sohPct,
    status: rider.sohPct < 70 ? 'Mode 2 Claim Eligible' : 'Active',
    claimable: rider.sohPct < 70,
    decrementMode: rider.sohPct < 70 ? 2 : 0,
    tier: rider.tier
  }));

  res.json(batteries);
});

app.post('/api/telematics/simulate-swap', (req, res) => {
  const { phoneNumber, dod, cellTemp, fastChargePct, harshEvents } = req.body || {};

  if (!phoneNumber) {
    return res.status(400).json({ error: 'phoneNumber is required.' });
  }

  let rider = getRiderByPhone(phoneNumber);
  if (!rider) {
    rider = defaultRiderForPhone(phoneNumber);
  }

  const newDod = dod ?? rider.dod;
  const newTemp = cellTemp ?? rider.cellTemp;
  const newFastChargePct = fastChargePct ?? rider.fastChargePct;
  const newHarshEvents = harshEvents ?? rider.harshEventsPer100km;

  rider.dod = Number(newDod);
  rider.cellTemp = Number(newTemp);
  rider.fastChargePct = Number(newFastChargePct);
  rider.harshEventsPer100km = Number(newHarshEvents);
  rider.weeklyKm = rider.weeklyKm || 520;
  rider.weeksActive = Math.max(1, rider.weeksActive || 1);

  rider.bsm = calculateBSM(rider);
  rider.cf = calculateCF(rider);
  rider.credibilityZ = calculateCredibility(rider.weeksActive);
  rider.adjustedBSM = rider.credibilityZ * rider.bsm + (1 - rider.credibilityZ) * fleetMeanBSM;
  rider.premium = calculateDynamicPremium({
    bsm: rider.bsm,
    cf: rider.cf,
    credibilityZ: rider.credibilityZ
  });
  rider.riskScore = clamp(Math.round((rider.harshEventsPer100km * 6.5 + (rider.weeklyKm / 20) + (Math.max(0, rider.cellTemp - 35) * 8) + (rider.fastChargePct * 100 * 0.8))), 0, 100);
  rider.sohPct = clamp(rider.sohPct - 0.12 * rider.bsm, 55, 99.9);
  rider.eligibleForMode2Replacement = rider.sohPct < 70;
  rider.status = rider.eligibleForMode2Replacement ? 'Eligible for Mode 2 Replacement' : 'Healthy';
  rider.claimToken = rider.eligibleForMode2Replacement ? 'BV-SWAP-99' : null;

  res.json({
    riderId: rider.riderId,
    name: rider.name,
    phoneNumber: rider.phoneNumber,
    county: rider.county,
    evModel: rider.evModel,
    tier: rider.tier,
    active: rider.active,
    sohPct: Number(rider.sohPct.toFixed(1)),
    dod: Number(rider.dod.toFixed(3)),
    cellTemp: Number(rider.cellTemp.toFixed(1)),
    fastChargePct: Number(rider.fastChargePct.toFixed(3)),
    harshEventsPer100km: Number(rider.harshEventsPer100km.toFixed(1)),
    weeklyKm: rider.weeklyKm,
    bsm: Number(rider.bsm.toFixed(3)),
    cf: Number(rider.cf.toFixed(3)),
    credibilityZ: Number(rider.credibilityZ.toFixed(3)),
    premium: Number(rider.premium.toFixed(2)),
    riskScore: rider.riskScore,
    mode2Eligible: rider.eligibleForMode2Replacement,
    claimToken: rider.claimToken,
    status: rider.status,
    packId: rider.packId
  });
});

function handleUSSDCallback(req, res) {
  const { phoneNumber, text = '' } = req.body || {};

  if (typeof phoneNumber !== 'string' || !phoneNumber.trim()) {
    return res
      .status(200)
      .type('text/plain')
      .send('END USSD request is missing the phone number.');
  }

  if (typeof text !== 'string') {
    return res
      .status(200)
      .type('text/plain')
      .send('END USSD request contains an invalid menu response.');
  }

  const responseText = getUSSDOutput(phoneNumber.trim(), text);
  return res
    .status(200)
    .type('text/plain')
    .send(responseText);
}

app.post(['/', '/ussd'], handleUSSDCallback);

app.get('/api/portfolio-metrics', (req, res) => {
  const meanFleetBSM = riders.reduce((sum, rider) => sum + rider.bsm, 0) / riders.length;
  const meanCredibility = riders.reduce((sum, rider) => sum + rider.credibilityZ, 0) / riders.length;
  const mode2ClaimCount = riders.filter((rider) => rider.sohPct < 70).length;
  const reserveLiability = mode2ClaimCount * claimSeverity * 2.6;
  const achievedLossRatio = 61.2;

  res.json({
    fleetSize: riders.length,
    meanFleetBSM: Number(meanFleetBSM.toFixed(3)),
    credibilityCoverage: Number((meanCredibility * 100).toFixed(1)),
    credibilityCoveragePct: Number((meanCredibility * 100).toFixed(1)),
    mode2ReserveLiability: Number(reserveLiability.toFixed(0)),
    mode2ClaimCount,
    lossRatio: achievedLossRatio,
    activeClaims: mode2ClaimCount,
    benchmarkLossRatio: 65.0
  });
});

function normalizePhoneNumber(phoneNumber) {
  const digits = String(phoneNumber || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('254')) return `+${digits}`;
  if (digits.length === 10 && digits.startsWith('0')) return `+254${digits.slice(1)}`;
  if (digits.length === 9 && /^[17]/.test(digits)) return `+254${digits}`;
  return null;
}

function validAccountDetails({ name, phoneNumber, evModel, plateNumber, password }) {
  return typeof name === 'string' && name.trim().length >= 2 &&
    Boolean(normalizePhoneNumber(phoneNumber)) &&
    typeof evModel === 'string' && evModel.trim().length > 0 &&
    typeof plateNumber === 'string' && plateNumber.trim().length > 0 &&
    typeof password === 'string' && password.length >= 8;
}

function createRiderSession(rider) {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  riderSessions.set(sessionToken, rider.phoneNumber);
  return sessionToken;
}

app.post('/api/auth/register', (req, res) => {
  const details = req.body || {};
  const phoneNumber = normalizePhoneNumber(details.phoneNumber);

  if (!validAccountDetails(details) || details.consent !== 'yes') {
    return res.status(400).json({ error: 'Enter your name, a valid Kenyan mobile number, bike model, plate number, an 8-character password, and accept the privacy notice.' });
  }

  if (riderAccounts.has(phoneNumber)) {
    return res.status(409).json({ error: 'An account already exists for this mobile number. Please log in.' });
  }

  const salt = crypto.randomBytes(16);
  const passwordHash = crypto.scryptSync(details.password, salt, 64);
  const rider = {
    riderId: `RDR_${crypto.randomInt(1000, 10000)}`,
    name: details.name.trim(),
    phoneNumber,
    county: String(details.county || '').trim(),
    evModel: details.evModel.trim(),
    plateNumber: details.plateNumber.trim().toUpperCase(),
    packId: String(details.packId || '').trim(),
    passwordSalt: salt,
    passwordHash,
    createdAt: new Date().toISOString()
  };

  riderAccounts.set(phoneNumber, rider);
  const sessionToken = createRiderSession(rider);
  return res.status(201).json({
    message: 'Your rider profile has been created. We will be in touch about cover availability and next steps.',
    sessionToken,
    rider: {
      riderId: rider.riderId,
      name: rider.name,
      phoneNumber: rider.phoneNumber,
      county: rider.county
    }
  });
});

app.post('/api/auth/login', (req, res) => {
  const { phoneNumber: submittedPhone, password } = req.body || {};
  const phoneNumber = normalizePhoneNumber(submittedPhone);
  const rider = phoneNumber ? riderAccounts.get(phoneNumber) : null;

  if (!rider || typeof password !== 'string') {
    return res.status(401).json({ error: 'Mobile number or password is incorrect.' });
  }

  const submittedHash = crypto.scryptSync(password, rider.passwordSalt, 64);
  if (!crypto.timingSafeEqual(submittedHash, rider.passwordHash)) {
    return res.status(401).json({ error: 'Mobile number or password is incorrect.' });
  }

  const sessionToken = createRiderSession(rider);
  return res.json({
    message: `Welcome back, ${rider.name}. Your rider account is ready.`,
    sessionToken,
    rider: {
      riderId: rider.riderId,
      name: rider.name,
      phoneNumber: rider.phoneNumber,
      county: rider.county
    }
  });
});

app.listen(port, () => {
  console.log(`BimaVolt Kenya Core Platform running on http://localhost:${port}`);
});
