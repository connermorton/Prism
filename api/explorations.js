import { createClient } from '@supabase/supabase-js';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getSupabase() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars not configured');
  return createClient(url, key);
}

function canonicalId(label, thinker) {
  return `${(label || '').trim().toLowerCase()}:${(thinker || '').trim().toLowerCase()}`;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET /api/explorations ────────────────────────────────────────────────
  if (req.method === 'GET') {
    let supabase;
    try { supabase = getSupabase(); } catch {
      return res.status(200).json({ explorations: [] });
    }

    const { data: explorations, error } = await supabase
      .from('explorations')
      .select('id, claim, created_at, synthesis, blind_spot')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });

    // Attach node counts and connection counts
    const enriched = await Promise.all((explorations || []).map(async (expl) => {
      const [{ count: nodeCount }, { count: connCount }] = await Promise.all([
        supabase
          .from('exploration_nodes')
          .select('*', { count: 'exact', head: true })
          .eq('exploration_id', expl.id),
        supabase
          .from('connections')
          .select('*', { count: 'exact', head: true })
          .or(`exploration_a_id.eq.${expl.id},exploration_b_id.eq.${expl.id}`)
          .then(({ count }) => ({ count })),
      ]);
      return {
        ...expl,
        node_count: nodeCount || 0,
        connections_count: connCount || 0,
        has_blind_spot: !!expl.blind_spot,
      };
    }));

    return res.status(200).json({ explorations: enriched });
  }

  // ── POST /api/explorations ───────────────────────────────────────────────
  if (req.method === 'POST') {
    let supabase;
    try { supabase = getSupabase(); } catch (e) {
      return res.status(503).json({ error: e.message });
    }

    const { claim, synthesis, blind_spot, graph_data } = req.body;
    if (!claim || !graph_data) {
      return res.status(400).json({ error: 'claim and graph_data required' });
    }

    // 1. Insert exploration
    const { data: exploration, error: explError } = await supabase
      .from('explorations')
      .insert({ claim, synthesis, blind_spot, graph_data })
      .select()
      .single();

    if (explError) return res.status(500).json({ error: explError.message });

    // 2. Upsert nodes + build junction records
    const nodeIdMap = {}; // graph node id (string) -> db uuid

    for (const node of graph_data.nodes || []) {
      const cid = canonicalId(node.label, node.thinker);

      // Check for existing canonical node
      const { data: existing } = await supabase
        .from('nodes')
        .select('id')
        .eq('canonical_id', cid)
        .maybeSingle();

      let dbNodeId;
      if (existing) {
        dbNodeId = existing.id;
      } else {
        const { data: newNode, error: nodeErr } = await supabase
          .from('nodes')
          .insert({
            label: node.label,
            thinker: node.thinker || null,
            era: node.era || null,
            period: node.period || null,
            description: node.description || null,
            key_insight: node.keyInsight || null,
            canonical_id: cid,
          })
          .select('id')
          .single();

        if (nodeErr) continue;
        dbNodeId = newNode.id;
      }

      nodeIdMap[node.id] = dbNodeId;

      await supabase.from('exploration_nodes').insert({
        exploration_id: exploration.id,
        node_id: dbNodeId,
        is_root: node.isRoot || false,
      }).select(); // ignore duplicate errors
    }

    // 3. Insert edges
    for (const edge of graph_data.edges || []) {
      const sourceId = nodeIdMap[edge.source];
      const targetId = nodeIdMap[edge.target];
      if (sourceId && targetId) {
        await supabase.from('exploration_edges').insert({
          exploration_id: exploration.id,
          source_node_id: sourceId,
          target_node_id: targetId,
          relationship: edge.relationship || null,
        });
      }
    }

    // 4. Connection detection — find other explorations sharing our nodes
    const dbNodeIds = Object.values(nodeIdMap);
    const connections = [];

    if (dbNodeIds.length > 0) {
      const { data: sharedRows } = await supabase
        .from('exploration_nodes')
        .select('node_id, exploration_id')
        .in('node_id', dbNodeIds)
        .neq('exploration_id', exploration.id);

      if (sharedRows && sharedRows.length > 0) {
        // Group shared node IDs by other exploration
        const byExploration = {};
        for (const row of sharedRows) {
          if (!byExploration[row.exploration_id]) byExploration[row.exploration_id] = [];
          byExploration[row.exploration_id].push(row.node_id);
        }

        for (const [otherExplId, sharedNodeIds] of Object.entries(byExploration)) {
          // Upsert connections (one row per shared node)
          for (const nodeId of sharedNodeIds) {
            await supabase.from('connections').upsert(
              { node_id: nodeId, exploration_a_id: exploration.id, exploration_b_id: otherExplId },
              { onConflict: 'node_id,exploration_a_id,exploration_b_id', ignoreDuplicates: true }
            );
          }

          // Fetch names for the response
          const [{ data: otherExpl }, { data: sharedNodes }] = await Promise.all([
            supabase.from('explorations').select('id, claim').eq('id', otherExplId).single(),
            supabase.from('nodes').select('id, label, thinker').in('id', sharedNodeIds),
          ]);

          if (otherExpl && sharedNodes) {
            connections.push({ exploration: otherExpl, sharedNodes });
          }
        }
      }
    }

    return res.status(200).json({ exploration, connections });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
