export function demoReport() {
  const entity = (name, amount, situation) => ({ name, amount, situation, delayDays: null, flags: [] });
  return { source: 'Ejemplo ficticio', demo: true, cuit: null, consultedAt: new Date().toISOString(), identity: { method: 'demo', verifiedIdentity: false }, sources: {
    current: { status: 'found', name: 'PERSONA DE EJEMPLO', durationMs: 0, periods: [{ period: '202608', total: 1850000, worstSituation: 1, entities: [entity('Entidad de ejemplo A', 1250000, 1), entity('Entidad de ejemplo B', 600000, 1)] }] },
    history: { status: 'found', durationMs: 0, periods: ['202608', '202607', '202606', '202605', '202604', '202603'].map((period, index) => ({ period, total: 1850000 + index * 120000, worstSituation: 1, entities: [entity('Entidad de ejemplo', 1850000 + index * 120000, 1)] })) },
    checks: { status: 'no_records', durationMs: 0 }
  } };
}
