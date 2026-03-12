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

  let supabase;
  try { supabase = getSupabase(); } catch {
    return res.status(200).json({ explorations: [], shared_nodes: [], links: [] });
  }

  // Fetch all explorations (basic info)
  const { data: explorations } = await supabase
    .from('explorations')
    .select('id, claim, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  // Fetch all connections
  const { data: connRows } = await supabase
    .from('connections')
    .select('id, node_id, exploration_a_id, exploration_b_id');

  if (!connRows || connRows.length === 0) {
    return res.status(200).json({
      explorations: explorations || [],
      shared_nodes: [],
      links: [],
    });
  }

  // Collect all unique node IDs referenced in connections
  const nodeIds = [...new Set(connRows.map(r => r.node_id))];
  const { data: nodes } = await supabase
    .from('nodes')
    .select('id, label, thinker, era')
    .in('id', nodeIds);

  const nodeMap = Object.fromEntries((nodes || []).map(n => [n.id, n]));

  // Collapse multiple shared nodes between the same pair → one link per pair
  // Key: sorted(exploration_a_id, exploration_b_id)
  const linkMap = {};
  for (const row of connRows) {
    const pairKey = [row.exploration_a_id, row.exploration_b_id].sort().join('::');
    if (!linkMap[pairKey]) {
      linkMap[pairKey] = {
        source_exploration: row.exploration_a_id,
        target_exploration: row.exploration_b_id,
        shared_nodes: [],
      };
    }
    const node = nodeMap[row.node_id];
    if (node) linkMap[pairKey].shared_nodes.push(node);
  }

  return res.status(200).json({
    explorations: explorations || [],
    shared_nodes: nodes || [],
    links: Object.values(linkMap),
  });
}
