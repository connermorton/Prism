import { createClient } from '@supabase/supabase-js';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase env vars not configured');
  return createClient(url, key);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });

  let supabase;
  try { supabase = getSupabase(); } catch (e) {
    return res.status(503).json({ error: e.message });
  }

  // Fetch exploration
  const { data: exploration, error } = await supabase
    .from('explorations')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !exploration) {
    return res.status(404).json({ error: 'Exploration not found' });
  }

  // Fetch connections (as exploration_a or exploration_b)
  const { data: connRows } = await supabase
    .from('connections')
    .select('node_id, exploration_a_id, exploration_b_id')
    .or(`exploration_a_id.eq.${id},exploration_b_id.eq.${id}`);

  const connections = [];

  if (connRows && connRows.length > 0) {
    // Group by other exploration
    const byOther = {};
    for (const row of connRows) {
      const otherId = row.exploration_a_id === id ? row.exploration_b_id : row.exploration_a_id;
      if (!byOther[otherId]) byOther[otherId] = [];
      byOther[otherId].push(row.node_id);
    }

    for (const [otherId, nodeIds] of Object.entries(byOther)) {
      const [{ data: otherExpl }, { data: sharedNodes }] = await Promise.all([
        supabase.from('explorations').select('id, claim').eq('id', otherId).single(),
        supabase.from('nodes').select('id, label, thinker').in('id', nodeIds),
      ]);

      if (otherExpl && sharedNodes) {
        connections.push({ exploration: otherExpl, sharedNodes });
      }
    }
  }

  return res.status(200).json({ exploration, connections });
}
