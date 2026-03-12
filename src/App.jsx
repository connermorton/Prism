import { useState, useRef, useEffect, useCallback } from "react";
import * as d3 from "d3";

const ERAS = {
  "Ancient": "#E07A5F",
  "Classical": "#D4A373",
  "Medieval": "#81B29A",
  "Renaissance": "#3D405B",
  "Enlightenment": "#F2CC8F",
  "Modern": "#5E81AC",
  "Contemporary": "#BF616A",
  "Timeless": "#A3BE8C",
};

function getEraColor(era) {
  for (const [key, color] of Object.entries(ERAS)) {
    if (era?.toLowerCase().includes(key.toLowerCase())) return color;
  }
  return "#88C0D0";
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return isMobile;
}

const LINEAGE_SYSTEM_PROMPT = `You are Prism, a knowledge lineage engine. Given a claim or idea, trace its intellectual lineage through history.

Return ONLY valid JSON (no markdown, no backticks, no preamble) with this exact structure:
{
  "nodes": [
    {
      "id": "unique_id",
      "label": "Short name of idea/concept (max 30 chars)",
      "thinker": "Primary thinker or school",
      "era": "One of: Ancient, Classical, Medieval, Renaissance, Enlightenment, Modern, Contemporary, Timeless",
      "period": "Approximate date range or year",
      "description": "2-3 sentence explanation of this idea/contribution",
      "keyInsight": "The single most important insight this node contributes to the lineage",
      "isRoot": false
    }
  ],
  "edges": [
    {
      "source": "source_node_id",
      "target": "target_node_id",
      "relationship": "influenced | challenged | evolved_into | synthesized | formalized | radicalized | popularized"
    }
  ],
  "synthesis": "A 2-3 sentence synthesis of the entire lineage — what is the meta-pattern across all these thinkers and ideas?"
}

Rules:
- The FIRST node must be the input claim itself with "isRoot": true
- Include 8-14 additional nodes tracing predecessors, challengers, and descendants
- Every node except the root must have at least one edge connecting it
- Edges flow FROM predecessor TO descendant (chronological influence direction)
- Include at least 2 nodes that CHALLENGE or CONTRADICT the claim
- Include ideas from diverse traditions (Western, Eastern, Indigenous, etc.) where relevant
- Be historically rigorous — cite real thinkers and real ideas
- Make the graph feel like a genuine intellectual genealogy, not a textbook summary`;

const DEEP_SYNTHESIS_PROMPT = `You are Prism's second-pass synthesis engine. You receive a claim and its full intellectual lineage graph (nodes and edges). Your job is NOT to summarize the lineage or sort thinkers into camps.

Your job is to find THE BLIND SPOT — the unstated assumption that ALL sides of the debate share, the hidden variable neither camp is examining, the question that would reframe the entire lineage if someone asked it.

Rules:
- Do NOT taxonomize ("one camp says X, another says Y")
- Do NOT summarize the graph
- DO identify what every thinker in the lineage takes for granted
- DO articulate the question or insight that a thinker 100 years from now would say everyone missed
- DO make the reader feel like they just saw the matrix — the synthesis should produce an "oh shit" moment
- Write 2-4 sentences maximum. Dense. Every word earns its place.
- Write in a voice that is intellectually precise but viscerally felt — not academic, not casual, but the register of someone who just realized something important at 2am

Return ONLY the synthesis text. No JSON, no markdown, no preamble.`;

async function callAPI(system, messages, maxTokens = 4000) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, messages, max_tokens: maxTokens }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || data.error || 'API error');
  return data;
}

// ─────────────────────────────────────────────────────────
// GraphVisualization
// ─────────────────────────────────────────────────────────
function GraphVisualization({ data, onNodeClick, sharedNodeLabels }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const shared = sharedNodeLabels || new Set();

  useEffect(() => {
    if (!data || !data.nodes || data.nodes.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    const defs = svg.append("defs");

    const filter = defs.append("filter").attr("id", "glow");
    filter.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "coloredBlur");
    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    const filterShared = defs.append("filter").attr("id", "glowShared");
    filterShared.append("feGaussianBlur").attr("stdDeviation", "5").attr("result", "coloredBlur");
    const feMergeShared = filterShared.append("feMerge");
    feMergeShared.append("feMergeNode").attr("in", "coloredBlur");
    feMergeShared.append("feMergeNode").attr("in", "SourceGraphic");

    defs.append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 28)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#4C566A");

    const g = svg.append("g");

    const zoom = d3.zoom()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    const initialTransform = d3.zoomIdentity.translate(width / 2, height / 2).scale(0.8);
    svg.call(zoom.transform, initialTransform);

    const clonedNodes = data.nodes.map(n => ({ ...n }));
    const links = data.edges.map(e => ({ source: e.source, target: e.target, relationship: e.relationship }));

    const simulation = d3.forceSimulation(clonedNodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(160))
      .force("charge", d3.forceManyBody().strength(-600))
      .force("center", d3.forceCenter(0, 0))
      .force("collision", d3.forceCollide().radius(50));

    const link = g.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#3B4252")
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.6)
      .attr("marker-end", "url(#arrow)");

    const linkLabel = g.append("g")
      .selectAll("text")
      .data(links)
      .join("text")
      .attr("font-size", "9px")
      .attr("fill", "#616E88")
      .attr("text-anchor", "middle")
      .attr("font-family", "'JetBrains Mono', monospace")
      .text(d => d.relationship || "");

    const node = g.append("g")
      .selectAll("g")
      .data(clonedNodes)
      .join("g")
      .style("cursor", "pointer")
      .call(d3.drag()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null; d.fy = null;
        })
      )
      .on("click", (event, d) => {
        event.stopPropagation();
        const orig = data.nodes.find(n => n.id === d.id);
        onNodeClick(orig || d);
      });

    // Shared-node outer ring (pulsing dashed)
    node.filter(d => shared.has(d.label?.toLowerCase()))
      .append("circle")
      .attr("r", d => (d.isRoot ? 24 : 18) + 7)
      .attr("fill", "none")
      .attr("stroke", "#88C0D0")
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "4,3")
      .attr("opacity", 0.7)
      .attr("filter", "url(#glowShared)");

    node.append("circle")
      .attr("r", d => d.isRoot ? 24 : 18)
      .attr("fill", d => {
        const color = getEraColor(d.era);
        return d.isRoot ? color : color + "CC";
      })
      .attr("stroke", d => d.isRoot ? "#ECEFF4" : getEraColor(d.era))
      .attr("stroke-width", d => d.isRoot ? 3 : 1.5)
      .attr("filter", d => d.isRoot ? "url(#glow)" : null);

    node.append("text")
      .attr("dy", d => (d.isRoot ? 24 : 18) + 16)
      .attr("text-anchor", "middle")
      .attr("fill", "#D8DEE9")
      .attr("font-size", d => d.isRoot ? "13px" : "11px")
      .attr("font-family", "'Space Grotesk', sans-serif")
      .attr("font-weight", d => d.isRoot ? "700" : "500")
      .text(d => d.label.length > 32 ? d.label.slice(0, 30) + "…" : d.label);

    node.append("text")
      .attr("dy", d => (d.isRoot ? 24 : 18) + 30)
      .attr("text-anchor", "middle")
      .attr("fill", "#616E88")
      .attr("font-size", "9px")
      .attr("font-family", "'JetBrains Mono', monospace")
      .text(d => d.period || "");

    simulation.on("tick", () => {
      link
        .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      linkLabel
        .attr("x", d => (d.source.x + d.target.x) / 2)
        .attr("y", d => (d.source.y + d.target.y) / 2);
      node.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    return () => simulation.stop();
  }, [data, onNodeClick, sharedNodeLabels]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}>
      <svg ref={svgRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// NodeDetail
// ─────────────────────────────────────────────────────────
function NodeDetail({ node, onClose, onExplore, isMobile, connections, onNavigateToExploration }) {
  if (!node) return null;

  // Find explorations this node also appears in (bridge node detection)
  const appearsIn = (connections || []).filter(conn =>
    (conn.sharedNodes || []).some(n => n.label?.toLowerCase() === node.label?.toLowerCase())
  );

  const mobileStyle = {
    position: "absolute",
    left: 0, right: 0, bottom: 44,
    top: "auto",
    width: "auto",
    maxHeight: "55vh",
    borderRadius: "12px 12px 0 0",
    borderBottom: "none",
  };

  const desktopStyle = {
    position: "absolute",
    right: 20, top: 20, bottom: 52,
    width: 340,
    borderRadius: 12,
  };

  return (
    <div style={{
      background: "#1a1d23", border: "1px solid #2E3440",
      padding: 24, overflowY: "auto",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)", zIndex: 10,
      fontFamily: "'Space Grotesk', sans-serif",
      ...(isMobile ? mobileStyle : desktopStyle),
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 16 }}>
        <div>
          <div style={{
            fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
            color: getEraColor(node.era), textTransform: "uppercase",
            letterSpacing: "0.1em", marginBottom: 4
          }}>{node.era}</div>
          <h3 style={{ color: "#ECEFF4", fontSize: 18, margin: 0, fontWeight: 700 }}>{node.label}</h3>
          <div style={{ color: "#616E88", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", marginTop: 4 }}>
            {node.period}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: "#616E88",
          fontSize: 20, cursor: "pointer", padding: 4, lineHeight: 1
        }}>✕</button>
      </div>
      {node.thinker && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: "#616E88", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>Thinker</div>
          <div style={{ color: "#D8DEE9", fontSize: 14 }}>{node.thinker}</div>
        </div>
      )}
      {node.description && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: "#616E88", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, fontFamily: "'JetBrains Mono', monospace" }}>Description</div>
          <div style={{ color: "#A3AEC2", fontSize: 14, lineHeight: 1.7 }}>{node.description}</div>
        </div>
      )}
      {node.keyInsight && (
        <div style={{
          background: "#2E3440", borderRadius: 8, padding: 14, marginBottom: 16,
          borderLeft: `3px solid ${getEraColor(node.era)}`
        }}>
          <div style={{ fontSize: 10, color: "#616E88", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>Key Insight</div>
          <div style={{ color: "#D8DEE9", fontSize: 14, lineHeight: 1.7, fontStyle: "italic" }}>{node.keyInsight}</div>
        </div>
      )}
      {appearsIn.length > 0 && (
        <div style={{
          background: "#88C0D008",
          border: "1px solid #88C0D022",
          borderRadius: 8, padding: "12px 14px",
          marginBottom: 12,
        }}>
          <div style={{
            fontSize: 10, color: "#88C0D077",
            textTransform: "uppercase", letterSpacing: "0.08em",
            marginBottom: 8, fontFamily: "'JetBrains Mono', monospace",
            display: "flex", alignItems: "center", gap: 5,
          }}>
            <span>⬡</span> Also in {appearsIn.length} other exploration{appearsIn.length !== 1 ? "s" : ""}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {appearsIn.map((conn, i) => (
              <button
                key={i}
                onClick={() => onNavigateToExploration && onNavigateToExploration(conn.exploration.id)}
                style={{
                  background: "none", border: "none", padding: "2px 0",
                  textAlign: "left", cursor: "pointer",
                  color: "#7A8394", fontSize: 12,
                  fontFamily: "'Space Grotesk', sans-serif",
                  lineHeight: 1.4,
                  transition: "color 0.15s",
                }}
                onMouseEnter={e => e.currentTarget.style.color = "#88C0D0"}
                onMouseLeave={e => e.currentTarget.style.color = "#7A8394"}
              >
                {conn.exploration.claim} →
              </button>
            ))}
          </div>
        </div>
      )}
      {!node.isRoot && (
        <button onClick={() => onExplore(node.label)} style={{
          width: "100%", padding: "10px 16px", background: getEraColor(node.era) + "22",
          border: `1px solid ${getEraColor(node.era)}44`, borderRadius: 8,
          color: getEraColor(node.era), fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 8,
          transition: "all 0.2s"
        }}>
          Trace lineage of "{node.label}" →
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// SynthesisBar
// ─────────────────────────────────────────────────────────
function SynthesisBar({ synthesis, deepSynthesis, deepLoading, onReadClick }) {
  if (!synthesis) return null;

  const previewText = deepSynthesis
    ? deepSynthesis
    : deepLoading
      ? "Finding the blind spot..."
      : synthesis;

  return (
    <div style={{
      position: "absolute", bottom: 0, left: 0, right: 0,
      height: 44,
      background: "#13161cF2",
      borderTop: "1px solid #2E3440",
      display: "flex", alignItems: "center",
      padding: "0 16px",
      zIndex: 8,
      backdropFilter: "blur(12px)",
      gap: 10,
    }}>
      {deepLoading && !deepSynthesis && (
        <span style={{
          display: "inline-block", width: 12, height: 12,
          border: "1.5px solid #2E3440", borderTopColor: "#88C0D0",
          borderRadius: "50%", animation: "spin 0.8s linear infinite",
          flexShrink: 0
        }} />
      )}
      {deepSynthesis && (
        <span style={{ fontSize: 10, color: "#88C0D0", fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>⬡</span>
      )}
      <span style={{
        color: deepSynthesis ? "#A3AEC2" : "#616E88",
        fontSize: 13,
        fontFamily: "'Space Grotesk', sans-serif",
        flex: 1,
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
        fontStyle: deepLoading && !deepSynthesis ? "italic" : "normal",
      }}>
        {previewText}
      </span>
      <button
        onClick={onReadClick}
        style={{
          background: "none", border: "none",
          color: "#88C0D0", fontSize: 12,
          fontFamily: "'JetBrains Mono', monospace",
          cursor: "pointer", flexShrink: 0,
          padding: "4px 10px",
          borderRadius: 6,
          letterSpacing: "0.04em",
          transition: "background 0.2s",
        }}
        onMouseEnter={e => e.currentTarget.style.background = "#88C0D015"}
        onMouseLeave={e => e.currentTarget.style.background = "none"}
      >
        Read →
      </button>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// NodeCards
// ─────────────────────────────────────────────────────────
function NodeCards({ nodes }) {
  if (!nodes || nodes.length === 0) return null;
  return (
    <div>
      <div style={{
        fontSize: 10, color: "#4C566A",
        fontFamily: "'JetBrains Mono', monospace",
        textTransform: "uppercase", letterSpacing: "0.1em",
        marginBottom: 12,
      }}>
        {nodes.length} nodes
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {nodes.map(node => (
          <div key={node.id} style={{
            padding: "10px 14px",
            background: "#1a1d23",
            borderRadius: 8,
            borderLeft: `3px solid ${getEraColor(node.era)}`,
            display: "flex", flexDirection: "column", gap: 3,
          }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <span style={{ color: "#D8DEE9", fontSize: 13, fontWeight: 600 }}>{node.label}</span>
              {node.isRoot && (
                <span style={{
                  fontSize: 9, color: "#88C0D0",
                  fontFamily: "'JetBrains Mono', monospace",
                  textTransform: "uppercase", letterSpacing: "0.1em",
                }}>root</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: "#7A8394", fontSize: 12 }}>{node.thinker}</span>
              <span style={{ color: "#4C566A", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>{node.period}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// ReadView
// ─────────────────────────────────────────────────────────
function ReadView({ claim, synthesis, deepSynthesis, deepLoading, nodes, connections, isMobile, onNavigateToExploration }) {
  const [activeTab, setActiveTab] = useState("lineage");

  useEffect(() => {
    if (deepSynthesis) setActiveTab("deep");
  }, [deepSynthesis]);

  useEffect(() => {
    if (!deepSynthesis && synthesis) setActiveTab("lineage");
  }, [synthesis, deepSynthesis]);

  const tabs = [
    { id: "lineage", label: "Lineage" },
    { id: "deep", label: "Blind Spot", loading: deepLoading },
  ];

  const activeContent = activeTab === "deep" && deepSynthesis ? deepSynthesis : synthesis;

  const tabBar = (
    <div style={{ display: "flex", borderBottom: "1px solid #2E3440", marginBottom: 24 }}>
      {tabs.map(tab => {
        const isActive = activeTab === tab.id;
        const isAvailable = tab.id === "lineage" || deepSynthesis || tab.loading;
        return (
          <button
            key={tab.id}
            onClick={() => { if (tab.id === "lineage" || deepSynthesis) setActiveTab(tab.id); }}
            style={{
              background: "none", border: "none",
              padding: "10px 16px 8px",
              color: isActive ? "#88C0D0" : "#4C566A",
              fontSize: 11, fontWeight: isActive ? 600 : 400,
              fontFamily: "'JetBrains Mono', monospace",
              textTransform: "uppercase", letterSpacing: "0.08em",
              cursor: isAvailable ? "pointer" : "default",
              borderBottom: isActive ? "2px solid #88C0D0" : "2px solid transparent",
              marginBottom: -1,
              transition: "all 0.2s",
              display: "flex", alignItems: "center", gap: 6,
              opacity: isAvailable ? 1 : 0.4,
            }}
          >
            {tab.id === "lineage" && <span style={{ fontSize: 10 }}>◈</span>}
            {tab.id === "deep" && !tab.loading && deepSynthesis && <span style={{ fontSize: 10 }}>⬡</span>}
            {tab.label}
            {tab.loading && (
              <span style={{
                display: "inline-block", width: 10, height: 10,
                border: "1.5px solid #2E3440", borderTopColor: "#88C0D0",
                borderRadius: "50%", animation: "spin 0.8s linear infinite"
              }} />
            )}
          </button>
        );
      })}
    </div>
  );

  const synthesisContent = (
    <>
      {activeTab === "deep" && deepLoading && !deepSynthesis && (
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          color: "#616E88", fontSize: 14, fontStyle: "italic",
          fontFamily: "'Space Grotesk', sans-serif",
          padding: "8px 0", marginBottom: 32,
        }}>
          <span style={{
            display: "inline-block", width: 14, height: 14,
            border: "2px solid #2E3440", borderTopColor: "#88C0D0",
            borderRadius: "50%", animation: "spin 0.8s linear infinite",
            flexShrink: 0
          }} />
          Searching for what both sides are missing...
        </div>
      )}
      {(activeTab === "lineage" || deepSynthesis) && activeContent && (
        <div style={{
          color: "#D8DEE9", fontSize: 19, lineHeight: 1.8,
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 400, letterSpacing: "0.01em",
        }}>
          {activeContent}
        </div>
      )}
    </>
  );

  const connectionsSection = connections && connections.length > 0 && (
    <div style={{ marginTop: 40, paddingTop: 32, borderTop: "1px solid #2E344066" }}>
      <div style={{
        fontSize: 10, color: "#88C0D0",
        fontFamily: "'JetBrains Mono', monospace",
        textTransform: "uppercase", letterSpacing: "0.1em",
        marginBottom: 16,
        display: "flex", alignItems: "center", gap: 6,
      }}>
        <span>⬡</span> Shared intellectual ancestors
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {connections.map((conn, i) => (
          <div key={i} style={{
            padding: "12px 16px",
            background: "#1a1d23",
            borderRadius: 8,
            borderLeft: "3px solid #88C0D044",
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            <button
              onClick={() => onNavigateToExploration && onNavigateToExploration(conn.exploration.id)}
              style={{
                background: "none", border: "none", padding: 0, textAlign: "left",
                color: "#88C0D0", fontSize: 13, fontWeight: 600,
                fontFamily: "'Space Grotesk', sans-serif",
                cursor: "pointer",
              }}
            >
              {conn.exploration.claim} →
            </button>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {conn.sharedNodes.map(n => {
                const eraColor = getEraColor(n.era);
                return (
                  <span key={n.id} style={{
                    fontSize: 11,
                    color: eraColor,
                    background: eraColor + "18",
                    border: `1px solid ${eraColor}33`,
                    borderRadius: 4, padding: "2px 8px",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    {n.label}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const claimHeader = (
    <h2 style={{
      fontFamily: "'Instrument Serif', serif",
      fontSize: isMobile ? 22 : 28,
      fontWeight: 400, color: "#ECEFF4",
      marginTop: 0, marginBottom: 32,
      lineHeight: 1.3, letterSpacing: "-0.01em",
    }}>
      {claim}
    </h2>
  );

  // Mobile: single column
  if (isMobile) {
    return (
      <div style={{
        position: "absolute", inset: 0, overflowY: "auto",
        padding: "28px 20px 40px",
        fontFamily: "'Space Grotesk', sans-serif",
        zIndex: 10, background: "#0d1017",
      }}>
        {claimHeader}
        {tabBar}
        <div style={{ marginBottom: 36 }}>{synthesisContent}</div>
        <NodeCards nodes={nodes} />
        {connectionsSection}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Desktop: split pane
  return (
    <div style={{
      position: "absolute", inset: 0, display: "flex",
      fontFamily: "'Space Grotesk', sans-serif",
      zIndex: 10, background: "#0d1017",
    }}>
      {/* Left — synthesis */}
      <div style={{
        flex: "0 0 58%", borderRight: "1px solid #1a1d23",
        overflowY: "auto", padding: "40px 40px 60px",
        display: "flex", flexDirection: "column",
      }}>
        {claimHeader}
        {tabBar}
        {synthesisContent}
        {connectionsSection}
      </div>
      {/* Right — node cards */}
      <div style={{
        flex: "0 0 42%", overflowY: "auto",
        padding: "40px 28px 60px", background: "#0b0e14",
      }}>
        <NodeCards nodes={nodes} />
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// MapView — meta-graph of explorations
// ─────────────────────────────────────────────────────────
function MapView({ onNavigateToExploration }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [mapData, setMapData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/connections')
      .then(r => r.json())
      .then(d => { setMapData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!mapData || !mapData.explorations || mapData.explorations.length === 0) return;

    const container = containerRef.current;
    if (!container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;

    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    const g = svg.append("g");

    const zoom = d3.zoom()
      .scaleExtent([0.2, 3])
      .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    const initialTransform = d3.zoomIdentity.translate(width / 2, height / 2).scale(0.9);
    svg.call(zoom.transform, initialTransform);

    const explorationNodes = mapData.explorations.map(e => ({ ...e }));
    const links = (mapData.links || []).map(l => ({
      source: l.source_exploration,
      target: l.target_exploration,
      sharedNodes: l.shared_nodes,
    }));

    const simulation = d3.forceSimulation(explorationNodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(200))
      .force("charge", d3.forceManyBody().strength(-500))
      .force("center", d3.forceCenter(0, 0))
      .force("collision", d3.forceCollide().radius(70));

    // Draw links
    const link = g.append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#88C0D044")
      .attr("stroke-width", 2);

    const linkLabel = g.append("g")
      .selectAll("text")
      .data(links)
      .join("text")
      .attr("font-size", "9px")
      .attr("fill", "#88C0D077")
      .attr("text-anchor", "middle")
      .attr("font-family", "'JetBrains Mono', monospace")
      .text(d => d.sharedNodes?.map(n => n.label).join(", ") || "");

    // Draw exploration nodes
    const node = g.append("g")
      .selectAll("g")
      .data(explorationNodes)
      .join("g")
      .style("cursor", "pointer")
      .call(d3.drag()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null; d.fy = null;
        })
      )
      .on("click", (event, d) => {
        event.stopPropagation();
        onNavigateToExploration(d.id);
      });

    node.append("circle")
      .attr("r", 28)
      .attr("fill", "#1a1d23")
      .attr("stroke", "#88C0D0")
      .attr("stroke-width", 1.5);

    node.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("fill", "#D8DEE9")
      .attr("font-size", "11px")
      .attr("font-family", "'Space Grotesk', sans-serif")
      .attr("font-weight", "600")
      .text(d => "◈");

    node.append("text")
      .attr("dy", 46)
      .attr("text-anchor", "middle")
      .attr("fill", "#A3AEC2")
      .attr("font-size", "10px")
      .attr("font-family", "'Space Grotesk', sans-serif")
      .text(d => d.claim.length > 28 ? d.claim.slice(0, 26) + "…" : d.claim);

    simulation.on("tick", () => {
      link
        .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      linkLabel
        .attr("x", d => (d.source.x + d.target.x) / 2)
        .attr("y", d => (d.source.y + d.target.y) / 2 - 6);
      node.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    return () => simulation.stop();
  }, [mapData, onNavigateToExploration]);

  if (loading) {
    return (
      <div style={{
        position: "absolute", inset: 0, display: "flex",
        alignItems: "center", justifyContent: "center",
        flexDirection: "column", gap: 16, background: "#0d1017", zIndex: 10,
      }}>
        <div style={{
          width: 40, height: 40,
          border: "2px solid #2E3440", borderTopColor: "#88C0D0",
          borderRadius: "50%", animation: "spin 1s linear infinite"
        }} />
        <div style={{ color: "#4C566A", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
          Loading map...
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        position: "absolute", inset: 0, display: "flex",
        alignItems: "center", justifyContent: "center",
        background: "#0d1017", zIndex: 10,
        color: "#BF616A", fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
      }}>
        Failed to load map: {error}
      </div>
    );
  }

  if (!mapData || !mapData.explorations || mapData.explorations.length === 0) {
    return (
      <div style={{
        position: "absolute", inset: 0, display: "flex",
        flexDirection: "column", alignItems: "center", justifyContent: "center",
        background: "#0d1017", zIndex: 10,
      }}>
        <div style={{ fontSize: 48, opacity: 0.1, marginBottom: 16 }}>⬡</div>
        <div style={{ color: "#4C566A", fontSize: 14, fontFamily: "'Space Grotesk', sans-serif", textAlign: "center", maxWidth: 320 }}>
          No explorations yet. Trace some lineages and the map will show how ideas connect across your explorations.
        </div>
      </div>
    );
  }

  if (!mapData.links || mapData.links.length === 0) {
    return (
      <div style={{
        position: "absolute", inset: 0, display: "flex",
        flexDirection: "column", alignItems: "center", justifyContent: "center",
        background: "#0d1017", zIndex: 10,
      }}>
        <div style={{ fontSize: 48, opacity: 0.1, marginBottom: 16 }}>⬡</div>
        <div style={{ color: "#4C566A", fontSize: 14, fontFamily: "'Space Grotesk', sans-serif", textAlign: "center", maxWidth: 360 }}>
          {mapData.explorations.length} exploration{mapData.explorations.length !== 1 ? "s" : ""} so far — no shared ancestors yet. Keep tracing lineages and connections will emerge.
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0, background: "#0d1017", zIndex: 10 }}>
      <svg ref={svgRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// HistoryPanel
// ─────────────────────────────────────────────────────────
function HistoryPanel({ history, activeClaim, isMobile, onClose, onHistoryClick }) {
  return (
    <>
      {isMobile && (
        <div
          onClick={onClose}
          style={{
            position: "absolute", inset: 0,
            background: "rgba(0,0,0,0.6)", zIndex: 19,
          }}
        />
      )}
      <div style={{
        position: "absolute", top: 0, bottom: 0, left: 0,
        width: isMobile ? "min(320px, 85vw)" : 280,
        maxHeight: "100%",
        background: "#13161cFD",
        borderRight: "1px solid #2E3440",
        zIndex: 20, overflowY: "auto",
        boxShadow: "4px 0 24px rgba(0,0,0,0.5)",
        backdropFilter: "blur(12px)",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{
          padding: "14px 18px 10px", borderBottom: "1px solid #2E344088",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: 11, color: "#88C0D0", textTransform: "uppercase",
            letterSpacing: "0.1em", fontFamily: "'JetBrains Mono', monospace", fontWeight: 500
          }}>Explorations</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 10, color: "#4C566A", fontFamily: "'JetBrains Mono', monospace" }}>
              {history.length} saved
            </span>
            {isMobile && (
              <button onClick={onClose} style={{
                background: "none", border: "none", color: "#616E88",
                fontSize: 18, cursor: "pointer", padding: "2px 4px", lineHeight: 1
              }}>✕</button>
            )}
          </div>
        </div>
        <div style={{ padding: "6px 8px 8px", overflowY: "auto", flex: 1 }}>
          {history.map((h) => {
            const isActive = h.claim === activeClaim;
            return (
              <button
                key={(h.id || h.claim) + "-" + (h.timestamp || "")}
                onClick={() => { onHistoryClick(h); if (isMobile) onClose(); }}
                style={{
                  display: "flex", width: "100%", textAlign: "left",
                  background: isActive ? "#88C0D00F" : "transparent",
                  border: isActive ? "1px solid #88C0D025" : "1px solid transparent",
                  borderRadius: 8, padding: "10px 12px", marginBottom: 2,
                  color: isActive ? "#88C0D0" : "#7A8394",
                  fontSize: 12, cursor: "pointer",
                  fontFamily: "'Space Grotesk', sans-serif",
                  transition: "all 0.15s", alignItems: "flex-start", gap: 10,
                  lineHeight: 1.4
                }}
                onMouseEnter={e => {
                  if (!isActive) { e.currentTarget.style.background = "#1a1d2388"; e.currentTarget.style.color = "#C8CED8"; }
                }}
                onMouseLeave={e => {
                  if (!isActive) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#7A8394"; }
                }}
              >
                <span style={{ color: isActive ? "#88C0D0" : "#3B4252", fontSize: 10, marginTop: 2, flexShrink: 0 }}>
                  {isActive ? "◈" : "○"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    overflow: "hidden", display: "-webkit-box",
                    WebkitLineClamp: 2, WebkitBoxOrient: "vertical"
                  }}>
                    {h.claim}
                  </div>
                  {h.connections_count > 0 && (
                    <div style={{
                      marginTop: 4, fontSize: 10, color: "#88C0D077",
                      fontFamily: "'JetBrains Mono', monospace",
                      display: "flex", alignItems: "center", gap: 4,
                    }}>
                      <span>⬡</span>
                      {h.connections_count} connection{h.connections_count !== 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────
// Example claims
// ─────────────────────────────────────────────────────────
const EXAMPLE_CLAIMS = [
  "Free will is an illusion",
  "Language shapes thought",
  "Consciousness is computation",
  "Power corrupts absolutely",
  "Beauty is truth",
  "The medium is the message",
  "History repeats itself",
  "Knowledge is justified true belief",
];

// ─────────────────────────────────────────────────────────
// Main Prism component
// ─────────────────────────────────────────────────────────
export default function Prism() {
  const isMobile = useIsMobile();

  const [claim, setClaim] = useState("");
  const [loading, setLoading] = useState(false);
  const [deepLoading, setDeepLoading] = useState(false);
  const [graphData, setGraphData] = useState(null);
  const [deepSynthesis, setDeepSynthesis] = useState(null);
  const [activeClaim, setActiveClaim] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);      // merged in-memory + DB
  const [showHistory, setShowHistory] = useState(false);
  const [viewMode, setViewMode] = useState("graph"); // "graph" | "read" | "map"
  const [connections, setConnections] = useState([]); // cross-exploration connections for current
  const [activeExplorationId, setActiveExplorationId] = useState(null);
  const [saving, setSaving] = useState(false);

  const cacheRef = useRef(new Map()); // claim -> { graphData, deepSynthesis, id, connections }

  // ── Load DB history on mount ──────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/explorations')
      .then(r => r.json())
      .then(({ explorations }) => {
        if (!explorations) return;
        setHistory(prev => {
          const inMemoryClaims = new Set(prev.map(h => h.claim));
          const dbOnly = explorations.filter(e => !inMemoryClaims.has(e.claim));
          return [...prev, ...dbOnly.map(e => ({
            id: e.id,
            claim: e.claim,
            timestamp: new Date(e.created_at).getTime(),
            connections_count: e.connections_count || 0,
            fromDb: true,
          }))];
        });
      })
      .catch(() => { /* Supabase not configured — silent */ });
  }, []);

  // ── Save exploration after both passes complete ───────────────────────────
  const saveExploration = useCallback(async (claimText, gData, blindSpot) => {
    setSaving(true);
    try {
      const resp = await fetch('/api/explorations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claim: claimText,
          synthesis: gData.synthesis,
          blind_spot: blindSpot,
          graph_data: gData,
        }),
      });
      if (!resp.ok) return;
      const { exploration, connections: newConns } = await resp.json();

      setActiveExplorationId(exploration.id);
      setConnections(newConns || []);

      // Update cache with DB id + connections
      const cached = cacheRef.current.get(claimText);
      if (cached) {
        cached.id = exploration.id;
        cached.connections = newConns || [];
        cacheRef.current.set(claimText, cached);
      }

      // Update history item with DB id and connection count
      setHistory(prev => prev.map(h =>
        h.claim === claimText
          ? { ...h, id: exploration.id, connections_count: newConns?.length || 0 }
          : h
      ));
    } catch {
      // Supabase not configured — silent
    } finally {
      setSaving(false);
    }
  }, []);

  // ── Deep synthesis ────────────────────────────────────────────────────────
  const runDeepSynthesis = useCallback(async (claimText, graphResult) => {
    setDeepLoading(true);
    try {
      const nodesSummary = graphResult.nodes.map(n =>
        `- ${n.label} (${n.thinker}, ${n.era}, ${n.period}): ${n.keyInsight}`
      ).join("\n");
      const edgesSummary = graphResult.edges.map(e =>
        `${e.source} → ${e.target} (${e.relationship})`
      ).join("\n");

      const data = await callAPI(DEEP_SYNTHESIS_PROMPT, [
        {
          role: "user",
          content: `CLAIM: "${claimText}"\n\nLINEAGE NODES:\n${nodesSummary}\n\nLINEAGE EDGES:\n${edgesSummary}\n\nINITIAL SYNTHESIS: ${graphResult.synthesis}\n\nNow find the blind spot.`
        }
      ], 1000);

      const text = data.content.filter(b => b.type === "text").map(b => b.text).join("").trim();

      const cached = cacheRef.current.get(claimText);
      if (cached) {
        cached.deepSynthesis = text;
        cacheRef.current.set(claimText, cached);
      }

      setDeepSynthesis(text);

      // Auto-save after both passes
      await saveExploration(claimText, graphResult, text);
    } catch (err) {
      console.error("Deep synthesis error:", err);
    } finally {
      setDeepLoading(false);
    }
  }, [saveExploration]);

  // ── Load from in-memory cache ─────────────────────────────────────────────
  const loadFromCache = useCallback((cachedClaim) => {
    const cached = cacheRef.current.get(cachedClaim);
    if (cached) {
      setGraphData(cached.graphData);
      setDeepSynthesis(cached.deepSynthesis || null);
      setDeepLoading(false);
      setActiveClaim(cachedClaim);
      setActiveExplorationId(cached.id || null);
      setConnections(cached.connections || []);
      setSelectedNode(null);
      setError(null);
      return true;
    }
    return false;
  }, []);

  // ── Load exploration from DB ──────────────────────────────────────────────
  const loadExplorationById = useCallback(async (id, claimText) => {
    try {
      const resp = await fetch(`/api/explorations/${id}`);
      if (!resp.ok) return false;
      const { exploration, connections: conns } = await resp.json();

      const gData = exploration.graph_data;
      if (!gData) return false;

      cacheRef.current.set(claimText, {
        graphData: gData,
        deepSynthesis: exploration.blind_spot || null,
        id: exploration.id,
        connections: conns || [],
      });

      setGraphData(gData);
      setDeepSynthesis(exploration.blind_spot || null);
      setDeepLoading(false);
      setActiveClaim(claimText);
      setActiveExplorationId(exploration.id);
      setConnections(conns || []);
      setSelectedNode(null);
      setError(null);
      return true;
    } catch {
      return false;
    }
  }, []);

  // ── Navigate to an exploration by DB id ──────────────────────────────────
  const navigateToExploration = useCallback(async (id) => {
    // Check if it's already in history/cache
    const histItem = history.find(h => h.id === id);
    if (histItem) {
      if (loadFromCache(histItem.claim)) {
        setViewMode("graph");
        return;
      }
      await loadExplorationById(id, histItem.claim);
      setViewMode("graph");
    }
  }, [history, loadFromCache, loadExplorationById]);

  // ── Trace lineage ─────────────────────────────────────────────────────────
  const traceLineage = useCallback(async (inputClaim) => {
    const c = inputClaim || claim;
    if (!c.trim()) return;

    setViewMode("graph");
    setShowHistory(false);

    if (cacheRef.current.has(c)) {
      loadFromCache(c);
      setHistory(prev => {
        const filtered = prev.filter(h => h.claim !== c);
        const existing = prev.find(h => h.claim === c);
        return [existing || { claim: c, timestamp: Date.now() }, ...filtered].slice(0, 50);
      });
      setClaim("");
      return;
    }

    setLoading(true);
    setError(null);
    setSelectedNode(null);
    setGraphData(null);
    setDeepSynthesis(null);
    setDeepLoading(false);
    setActiveClaim(c);
    setConnections([]);
    setActiveExplorationId(null);

    try {
      const data = await callAPI(LINEAGE_SYSTEM_PROMPT, [
        { role: "user", content: `Trace the intellectual lineage of this claim: "${c}"` }
      ], 4000);

      const text = data.content.filter(b => b.type === "text").map(b => b.text).join("");
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      if (!parsed.nodes || !parsed.edges) throw new Error("Invalid response structure");

      cacheRef.current.set(c, { graphData: parsed, deepSynthesis: null, id: null, connections: [] });

      setGraphData(parsed);
      setHistory(prev => {
        const filtered = prev.filter(h => h.claim !== c);
        return [{ claim: c, timestamp: Date.now(), connections_count: 0 }, ...filtered].slice(0, 50);
      });
      setClaim("");

      runDeepSynthesis(c, parsed);
    } catch (err) {
      console.error(err);
      setError(err.message || "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }, [claim, loadFromCache, runDeepSynthesis]);

  // ── History click ─────────────────────────────────────────────────────────
  const handleHistoryClick = useCallback(async (histItem) => {
    const { claim: c, id, fromDb } = histItem;

    // Try in-memory cache first
    if (loadFromCache(c)) {
      setViewMode("graph");
      return;
    }

    // If we have a DB id, fetch from API
    if (id) {
      setActiveClaim(c);
      setViewMode("graph");
      setGraphData(null);
      setDeepSynthesis(null);
      setConnections([]);
      await loadExplorationById(id, c);
      return;
    }

    // Otherwise re-trace
    traceLineage(c);
  }, [loadFromCache, loadExplorationById, traceLineage]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      traceLineage();
    }
  };

  const historyPanelOpen = showHistory && history.length > 0 && graphData;
  const eraLegendLeft = (!isMobile && historyPanelOpen) ? 300 : 20;

  // Shared node labels for graph highlighting
  const sharedNodeLabels = new Set(
    connections.flatMap(c => (c.sharedNodes || []).map(n => n.label?.toLowerCase()))
  );

  const VIEW_MODES = graphData ? ["graph", "read", "map"] : [];

  return (
    <div style={{
      width: "100vw", height: "100vh", background: "#0d1017",
      fontFamily: "'Space Grotesk', sans-serif", color: "#D8DEE9",
      display: "flex", flexDirection: "column", overflow: "hidden",
      position: "relative"
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Instrument+Serif&display=swap" rel="stylesheet" />

      <div style={{
        position: "absolute", inset: 0, opacity: 0.4,
        background: "radial-gradient(ellipse at 20% 50%, #1a1f3520 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, #2e344010 0%, transparent 50%)",
        pointerEvents: "none"
      }} />

      {/* ── Header ── */}
      <div style={{
        padding: isMobile ? "12px 16px" : "14px 24px",
        borderBottom: "1px solid #1a1d23",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "relative", zIndex: 5, flexShrink: 0,
        background: "#0d1017ee", backdropFilter: "blur(12px)",
        gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          <h1 style={{
            margin: 0, fontSize: isMobile ? 18 : 22, fontWeight: 700,
            fontFamily: "'Instrument Serif', serif", color: "#ECEFF4",
            letterSpacing: "-0.02em", whiteSpace: "nowrap",
          }}>
            <span style={{ color: "#88C0D0" }}>◈</span> PRISM
          </h1>
          {!isMobile && (
            <span style={{
              fontSize: 10, color: "#4C566A", fontFamily: "'JetBrains Mono', monospace",
              textTransform: "uppercase", letterSpacing: "0.15em"
            }}>Knowledge Lineage Engine</span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {/* View mode toggle */}
          {VIEW_MODES.length > 0 && (
            <div style={{
              display: "flex", background: "#1a1d23",
              border: "1px solid #2E3440", borderRadius: 8, padding: 3, gap: 2,
            }}>
              {VIEW_MODES.map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  style={{
                    background: viewMode === mode ? "#2E3440" : "transparent",
                    border: "none", borderRadius: 6,
                    padding: isMobile ? "5px 9px" : "5px 13px",
                    color: viewMode === mode ? "#ECEFF4" : "#4C566A",
                    fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                    cursor: "pointer", textTransform: "uppercase",
                    letterSpacing: "0.08em", transition: "all 0.2s",
                  }}
                >
                  {mode === "graph" ? "Graph" : mode === "read" ? "Read" : "Map"}
                </button>
              ))}
            </div>
          )}

          {/* Saving indicator */}
          {saving && (
            <span style={{
              fontSize: 10, color: "#4C566A", fontFamily: "'JetBrains Mono', monospace",
              display: "flex", alignItems: "center", gap: 4,
            }}>
              <span style={{
                display: "inline-block", width: 8, height: 8,
                border: "1px solid #2E3440", borderTopColor: "#88C0D0",
                borderRadius: "50%", animation: "spin 0.8s linear infinite",
              }} />
              {!isMobile && "saving"}
            </span>
          )}

          {/* History toggle */}
          {history.length > 0 && graphData && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              style={{
                background: showHistory ? "#1a1d23" : "transparent",
                border: "1px solid #2E3440", borderRadius: 8,
                padding: isMobile ? "6px 10px" : "6px 14px",
                color: showHistory ? "#88C0D0" : "#616E88",
                fontSize: 11, cursor: "pointer",
                fontFamily: "'JetBrains Mono', monospace",
                display: "flex", alignItems: "center", gap: 5,
                transition: "all 0.2s", whiteSpace: "nowrap",
              }}
            >
              <span style={{ fontSize: 13 }}>☰</span>
              {!isMobile && `${history.length} exploration${history.length !== 1 ? "s" : ""}`}
              {isMobile && history.length}
            </button>
          )}
        </div>
      </div>

      {/* ── Main ── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>

        {/* Empty state */}
        {!graphData && !loading && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            flexDirection: "column", alignItems: "center", justifyContent: "center",
            zIndex: 2, padding: isMobile ? 24 : 40
          }}>
            <div style={{ fontSize: isMobile ? 48 : 64, marginBottom: 16, opacity: 0.15 }}>◈</div>
            <h2 style={{
              fontFamily: "'Instrument Serif', serif", fontSize: isMobile ? 24 : 32,
              fontWeight: 400, color: "#4C566A", marginBottom: 8, textAlign: "center"
            }}>
              Every idea has ancestors.
            </h2>
            <p style={{ color: "#3B4252", fontSize: 13, marginBottom: 28, textAlign: "center", maxWidth: 400 }}>
              Enter a claim, belief, or idea — Prism will trace its intellectual lineage across civilizations, thinkers, and millennia.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: isMobile ? 340 : 600 }}>
              {EXAMPLE_CLAIMS.map(ex => (
                <button key={ex} onClick={() => { setClaim(ex); traceLineage(ex); }} style={{
                  background: "#1a1d2366", border: "1px solid #2E344066",
                  borderRadius: 20, padding: "7px 14px", color: "#616E88",
                  fontSize: 12, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif",
                  transition: "all 0.2s"
                }}
                  onMouseEnter={e => { e.target.style.borderColor = "#88C0D0"; e.target.style.color = "#88C0D0"; }}
                  onMouseLeave={e => { e.target.style.borderColor = "#2E344066"; e.target.style.color = "#616E88"; }}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading spinner */}
        {loading && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            flexDirection: "column", alignItems: "center", justifyContent: "center",
            zIndex: 3, background: "#0d1017dd"
          }}>
            <div style={{ position: "relative", width: 60, height: 60, marginBottom: 20 }}>
              <div style={{
                position: "absolute", inset: 0, border: "2px solid #2E3440",
                borderTopColor: "#88C0D0", borderRadius: "50%",
                animation: "spin 1s linear infinite"
              }} />
              <div style={{
                position: "absolute", inset: 8, border: "2px solid #2E3440",
                borderBottomColor: "#5E81AC", borderRadius: "50%",
                animation: "spin 1.5s linear infinite reverse"
              }} />
            </div>
            <div style={{ color: "#616E88", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
              Tracing lineage...
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            position: "absolute", top: 20, left: "50%", transform: "translateX(-50%)",
            background: "#BF616A22", border: "1px solid #BF616A44", borderRadius: 8,
            padding: "12px 20px", color: "#BF616A", fontSize: 13, zIndex: 10,
            fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap",
          }}>
            {error}
          </div>
        )}

        {/* ── Graph mode ── */}
        {graphData && viewMode === "graph" && (
          <>
            <GraphVisualization
              data={graphData}
              onNodeClick={setSelectedNode}
              sharedNodeLabels={sharedNodeLabels}
            />

            <NodeDetail
              node={selectedNode}
              onClose={() => setSelectedNode(null)}
              onExplore={(label) => { setClaim(label); traceLineage(label); }}
              isMobile={isMobile}
              connections={connections}
              onNavigateToExploration={(id) => { navigateToExploration(id); setViewMode("graph"); }}
            />

            {/* Era legend — desktop only */}
            {!isMobile && (
              <div style={{
                position: "absolute", bottom: 52, left: eraLegendLeft,
                display: "flex", flexWrap: "wrap", gap: 8, zIndex: 5, maxWidth: 300,
                transition: "left 0.3s ease"
              }}>
                {Object.entries(ERAS).map(([era, color]) => (
                  <div key={era} style={{
                    display: "flex", alignItems: "center", gap: 5,
                    fontSize: 10, color: "#4C566A", fontFamily: "'JetBrains Mono', monospace"
                  }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                    {era}
                  </div>
                ))}
              </div>
            )}

            <SynthesisBar
              synthesis={graphData?.synthesis}
              deepSynthesis={deepSynthesis}
              deepLoading={deepLoading}
              onReadClick={() => setViewMode("read")}
            />

            {/* History drawer */}
            {historyPanelOpen && (
              <HistoryPanel
                history={history}
                activeClaim={activeClaim}
                isMobile={isMobile}
                onClose={() => setShowHistory(false)}
                onHistoryClick={handleHistoryClick}
              />
            )}
          </>
        )}

        {/* ── Read mode ── */}
        {graphData && viewMode === "read" && (
          <ReadView
            claim={activeClaim}
            synthesis={graphData?.synthesis}
            deepSynthesis={deepSynthesis}
            deepLoading={deepLoading}
            nodes={graphData?.nodes}
            connections={connections}
            isMobile={isMobile}
            onNavigateToExploration={(id) => { navigateToExploration(id); }}
          />
        )}

        {/* ── Map mode ── */}
        {graphData && viewMode === "map" && (
          <MapView onNavigateToExploration={navigateToExploration} />
        )}
      </div>

      {/* ── Input ── */}
      <div style={{
        padding: isMobile ? "10px 12px 12px" : "12px 24px 16px",
        borderTop: "1px solid #1a1d23",
        background: "#0d1017ee", backdropFilter: "blur(12px)",
        position: "relative", zIndex: 9, flexShrink: 0
      }}>
        <div style={{ display: "flex", gap: 8, maxWidth: 720, margin: "0 auto", alignItems: "center" }}>
          <input
            value={claim}
            onChange={e => setClaim(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What's been on your mind?"
            disabled={loading}
            style={{
              flex: 1, padding: isMobile ? "11px 14px" : "12px 16px",
              background: "#1a1d23", border: "1px solid #2E3440",
              borderRadius: 10, color: "#ECEFF4", fontSize: 14,
              fontFamily: "'Space Grotesk', sans-serif",
              outline: "none", boxSizing: "border-box",
              transition: "border-color 0.2s", minWidth: 0,
            }}
            onFocus={e => e.target.style.borderColor = "#88C0D0"}
            onBlur={e => e.target.style.borderColor = "#2E3440"}
          />
          <button
            onClick={() => traceLineage()}
            disabled={loading || !claim.trim()}
            style={{
              padding: isMobile ? "11px 16px" : "12px 24px",
              background: claim.trim() ? "#88C0D0" : "#2E3440",
              border: "none", borderRadius: 10,
              color: claim.trim() ? "#0d1017" : "#4C566A",
              fontSize: 13, fontWeight: 600, cursor: claim.trim() ? "pointer" : "default",
              fontFamily: "'Space Grotesk', sans-serif",
              transition: "all 0.2s", whiteSpace: "nowrap", flexShrink: 0,
            }}
          >
            {isMobile ? "◈" : "Trace ◈"}
          </button>
        </div>
      </div>
    </div>
  );
}
