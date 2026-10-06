function readActuarialInputs(formId, fields) {
  const form = document.getElementById(formId);
  if (!form) return null;

  const values = {};
  for (const field of fields) {
    const input = document.getElementById(field.id);
    if (!input || input.value.trim() === '' || !input.validity.valid) return null;
    values[field.id] = input.valueAsNumber;
  }
  return values;
}

function formatNumber(value, digits = 3) {
  return new Intl.NumberFormat('en-KE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

function formatKES(value) {
  return `KES ${formatNumber(value, 2)}`;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function updatePremiumModel() {
  const values = readActuarialInputs('premium-form', [
    { id: 'dod' },
    { id: 'cell-temp' },
    { id: 'fast-charge' },
    { id: 'experience' },
    { id: 'fleet-bsm' },
    { id: 'credibility-k' },
    { id: 'base-premium' },
    { id: 'collision-factor' }
  ]);

  if (!values || values['credibility-k'] <= 0 || values['base-premium'] <= 0 || values['collision-factor'] <= 0) {
    setText('premium-result', '—');
    setText('bsm-result', '—');
    setText('credibility-result', '—');
    setText('blended-bsm-result', '—');
    setText('applied-collision-result', '—');
    setText('premium-status', 'Enter valid values in all fields to calculate the indicated premium.');
    return;
  }

  const bsm = Math.exp(
    1.5 * Math.max(0, values.dod / 100 - 0.8) +
    0.04 * Math.max(0, values['cell-temp'] - 35) +
    0.5 * (values['fast-charge'] / 100)
  );
  const credibility = values.experience / (values.experience + values['credibility-k']);
  const blendedBSM = credibility * bsm + (1 - credibility) * values['fleet-bsm'];
  const premium = values['base-premium'] * blendedBSM * values['collision-factor'];

  setText('premium-result', formatNumber(premium, 2));
  setText('bsm-result', formatNumber(bsm));
  setText('credibility-result', `${formatNumber(credibility * 100, 1)}%`);
  setText('blended-bsm-result', formatNumber(blendedBSM));
  setText('applied-collision-result', formatNumber(values['collision-factor'], 2));
  setText(
    'premium-status',
    premium < 18 || premium > 36
      ? 'Outside the blueprint range of KES 18-36 per swap; review the assumptions and calibration.'
      : 'Within the blueprint range of KES 18-36 per swap. This is an illustration, not an approved quote.'
  );
}

function updateDecrementModel() {
  const values = readActuarialInputs('decrement-form', [
    { id: 'collision-force' },
    { id: 'degradation-force' },
    { id: 'thermal-force' },
    { id: 'exposure-cycles' }
  ]);

  if (!values) {
    for (const id of ['survival-result', 'mode-one-result', 'mode-two-result', 'mode-three-result', 'total-decrement-result']) {
      setText(id, '—');
    }
    setText('decrement-status', 'Enter valid non-negative rates and exposure to calculate probabilities.');
    return;
  }

  const rates = [
    values['collision-force'] / 1000,
    values['degradation-force'] / 1000,
    values['thermal-force'] / 1000
  ];
  const totalForce = rates.reduce((sum, rate) => sum + rate, 0);
  const totalDecrement = totalForce === 0
    ? 0
    : -Math.expm1(-totalForce * values['exposure-cycles']);
  const survival = 1 - totalDecrement;
  const causeProbabilities = totalForce === 0
    ? rates.map(() => 0)
    : rates.map((rate) => (rate / totalForce) * totalDecrement);

  setText('survival-result', `${formatNumber(survival * 100, 2)}%`);
  setText('mode-one-result', `${formatNumber(causeProbabilities[0] * 100, 2)}%`);
  setText('mode-two-result', `${formatNumber(causeProbabilities[1] * 100, 2)}%`);
  setText('mode-three-result', `${formatNumber(causeProbabilities[2] * 100, 2)}%`);
  setText('total-decrement-result', `${formatNumber(totalDecrement * 100, 2)}%`);
  setText('decrement-status', 'Calculated under constant cause-specific forces across the entered exposure.');
}

function updateReserveModel() {
  const values = readActuarialInputs('reserve-form', [
    { id: 'written-premium' },
    { id: 'unexpired-share' },
    { id: 'ultimate-claims' },
    { id: 'reported-claims' }
  ]);

  if (!values) {
    setText('upr-result', '—');
    setText('ibnr-result', '—');
    setText('reserve-status', 'Enter valid non-negative estimates to calculate indicative reserves.');
    return;
  }

  const upr = values['written-premium'] * values['unexpired-share'] / 100;
  const ibnr = Math.max(0, values['ultimate-claims'] - values['reported-claims']);
  setText('upr-result', formatKES(upr));
  setText('ibnr-result', formatKES(ibnr));
  setText(
    'reserve-status',
    values['reported-claims'] > values['ultimate-claims']
      ? 'Reported claims exceed expected ultimate claims; the illustrative IBNR estimate is floored at zero.'
      : 'Illustrative monitoring estimates only; validate the valuation basis before financial reporting.'
  );
}

function updateRiderEstimate(event) {
  event.preventDefault();
  const form = document.getElementById('rider-estimate-form');
  if (!form || !form.reportValidity()) return;

  const batteryUse = Number(document.getElementById('rider-battery-use').value);
  const temperature = Number(document.getElementById('rider-heat').value);
  const fastChargeShare = Number(document.getElementById('rider-fast-charge').value);
  const experienceWeeks = Number(document.getElementById('rider-weeks').value);
  const weeklySwaps = Number(document.getElementById('rider-swaps').value);

  const bsm = Math.exp(
    1.5 * Math.max(0, batteryUse / 100 - 0.8) +
    0.04 * Math.max(0, temperature - 35) +
    0.5 * (fastChargeShare / 100)
  );
  const credibility = experienceWeeks / (experienceWeeks + 2);
  const fleetBSM = 1.08;
  const basePremium = 25;
  const blendedBSM = credibility * bsm + (1 - credibility) * fleetBSM;
  const perSwap = basePremium * blendedBSM;

  setText('rider-price-result', formatKES(perSwap));
  setText('rider-weekly-result', formatKES(perSwap * weeklySwaps));
  setText('rider-swaps-result', `Based on ${formatNumber(weeklySwaps, 0)} swaps per week`);
  setText(
    'rider-result-explanation',
    `This example is based on the battery-use options you selected and ${formatNumber(experienceWeeks, 0)} weeks of experience. It blends your answers with a fleet average while the model is being tested.`
  );

  document.getElementById('rider-estimate-empty').hidden = true;
  document.getElementById('rider-estimate-values').hidden = false;
  document.getElementById('rider-result-title').focus();
}

document.getElementById('premium-form')?.addEventListener('input', updatePremiumModel);
document.getElementById('decrement-form')?.addEventListener('input', updateDecrementModel);
document.getElementById('reserve-form')?.addEventListener('input', updateReserveModel);
document.getElementById('rider-estimate-form')?.addEventListener('submit', updateRiderEstimate);
document.getElementById('rider-estimate-form')?.addEventListener('reset', () => {
  document.getElementById('rider-estimate-empty').hidden = false;
  document.getElementById('rider-estimate-values').hidden = true;
});
document.querySelectorAll('.actuarial-fields').forEach((form) => {
  form.addEventListener('submit', (event) => event.preventDefault());
});

updatePremiumModel();
updateDecrementModel();
updateReserveModel();
