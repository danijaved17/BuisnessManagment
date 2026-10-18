const { sql, init, COLS } = require('./_db');
const { authorized } = require('./_auth');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
    await init();

    if (req.method === 'GET') {
      const since = Number(req.query.since) || 0;
      const rows = await sql`SELECT id, col, data, updated_at, deleted, seq FROM records WHERE seq > ${since} ORDER BY seq LIMIT 5000`;
      return res.status(200).json({
        cursor: rows.length ? Number(rows[rows.length - 1].seq) : since,
        records: rows.map(r => ({ id: r.id, col: r.col, data: r.data, updatedAt: Number(r.updated_at), deleted: r.deleted }))
      });
    }

    if (req.method === 'POST') {
      const list = (Array.isArray(req.body?.records) ? req.body.records : [])
        .filter(r => r && typeof r.id === 'string' && COLS.has(r.col) && Number.isFinite(r.updatedAt));
      if (list.length) {
        // Last-write-wins: only replace a row if the incoming edit is newer.
        await sql.transaction(list.map(r => sql`
          INSERT INTO records (id, col, data, updated_at, deleted)
          VALUES (${r.id}, ${r.col}, ${JSON.stringify(r.data ?? {})}::jsonb, ${r.updatedAt}, ${r.deleted ? 1 : 0})
          ON CONFLICT (id) DO UPDATE SET col = EXCLUDED.col, data = EXCLUDED.data,
            updated_at = EXCLUDED.updated_at, deleted = EXCLUDED.deleted, seq = nextval('records_seq')
          WHERE records.updated_at < EXCLUDED.updated_at`));
      }
      return res.status(200).json({ applied: list.length });
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
};
