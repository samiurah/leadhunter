import { useState, useCallback } from "react";
import Head from "next/head";

// ── Helpers ──
function getWebsiteLabel(hasWebsite, linkType) {
  if (linkType === "real" || hasWebsite) return { label: "✅ Website আছে", hot: false };
  if (linkType === "linktree") return { label: "⚠️ Linktree Only", hot: true };
  if (linkType === "facebook") return { label: "⚠️ FB Link Only", hot: true };
  return { label: "❌ Website নেই", hot: true };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function calcStats(arr) {
  return {
    total: arr.length,
    hot: arr.filter(l => l.hot).length,
    noWeb: arr.filter(l => !l.hasWebsite).length,
  };
}


const inputStyle = {
  width: "100%",
  background: "#1a1a26",
  border: "1px solid #2a2a3d",
  borderRadius: 8,
  padding: "10px 12px",
  color: "#e8e8f0",
  fontFamily: "monospace",
  fontSize: 12,
  outline: "none",
  boxSizing: "border-box",
};

// ── Main Component ──
export default function LeadHunter() {
  const [location, setLocation] = useState("Dhaka, Bangladesh");
  const [category, setCategory] = useState("restaurant");
  const [sources, setSources] = useState({ gm: true });
  const [filters, setFilters] = useState({ nowebsite: true, lowrating: true });

  const [leads, setLeads] = useState([]);
  const [logs, setLogs] = useState([]);
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ total: 0, hot: 0, noWeb: 0 });
  const [error, setError] = useState("");

  // ── Log helper ──
  const addLog = useCallback((msg, type = "") => {
    const time = new Date().toLocaleTimeString("en", { hour12: false });
    setLogs(prev => [...prev.slice(-50), { msg, type, time }]);
  }, []);

  // ── Hot lead check ──
  const isHot = useCallback((lead, f) => {
    const ff = f || filters;
    if (ff.nowebsite && !lead.hasWebsite) return true;
    if (ff.lowrating && lead.rating && lead.rating < 3.5) return true;
    return false;
  }, [filters]);

  // ── Duplicate check by name ──
  function isDuplicate(existing, name) {
    return existing.some(l => l.name.toLowerCase().trim() === name.toLowerCase().trim());
  }

  // ── Google Maps fetch ──
  async function fetchGoogleMaps(collected, currentFilters) {
    const query = `${category} in ${location}`;
    addLog(`🗺 Google Maps scanning — "${query}"...`);

    try {
      const searchRes = await fetch(`/api/places-search?query=${encodeURIComponent(query)}`);
      if (!searchRes.ok) throw new Error(`HTTP ${searchRes.status}`);
      const searchData = await searchRes.json();

      if (searchData.error) {
        addLog(`❌ ${searchData.error}`, "error");
        setError(searchData.error);
        return collected;
      }

      if (searchData.status === "REQUEST_DENIED") {
        const msg = "API Key invalid বা Places API enable নেই!";
        addLog(`❌ ${msg}`, "error");
        setError(msg);
        return collected;
      }

      if (searchData.status === "ZERO_RESULTS") {
        addLog("⚠️ কোনো result পাওয়া যায়নি", "warn");
        return collected;
      }

      const places = searchData.results || [];
      addLog(`✓ ${places.length} places found! Details loading...`);
      setProgress(15);

      // Limit to 15 to avoid rate limit
      const limit = Math.min(places.length, 15);

      for (let i = 0; i < limit; i++) {
        // Rate limit: 200ms between requests
        await sleep(200);
        const place = places[i];

        try {
          const detailRes = await fetch(`/api/places-details?place_id=${encodeURIComponent(place.place_id)}`);
          if (!detailRes.ok) throw new Error(`HTTP ${detailRes.status}`);
          const detailData = await detailRes.json();
          const d = detailData.result || {};

          const hasWebsite = !!d.website;
          const ws = getWebsiteLabel(hasWebsite, hasWebsite ? "real" : "none");
          const name = d.name || place.name;

          // Skip duplicates
          if (isDuplicate(collected, name)) {
            addLog(`⏭ Duplicate skipped: ${name}`, "warn");
            continue;
          }

          const lead = {
            id: "gm_" + place.place_id,
            source: "Google Maps",
            name,
            phone: d.formatted_phone_number || "",
            address: d.formatted_address || place.formatted_address || "",
            rating: d.rating || place.rating || null,
            reviewCount: d.user_ratings_total || 0,
            hasWebsite,
            website: d.website || "",
            websiteLabel: ws.label,

          };
          lead.hot = isHot(lead, currentFilters);
          collected = [...collected, lead];

          addLog(
            `✓ ${name} — ⭐${lead.rating || "N/A"} | ${ws.label}`,
            !hasWebsite ? "warn" : "success"
          );

          // Update progress incrementally
          setProgress(15 + Math.round((i / limit) * 30));
        } catch (detailErr) {
          addLog(`⚠️ ${place.name} details failed: ${detailErr.message}`, "warn");
        }
      }

      // Batch update leads once after GM done (performance)
      setLeads([...collected]);
      setStats(calcStats(collected));
      setProgress(45);
      addLog(`✅ Google Maps: ${collected.filter(l => l.source === "Google Maps").length} businesses loaded!`, "success");
      return collected;

    } catch (err) {
      addLog(`❌ Google Maps error: ${err.message}`, "error");
      setError(`Google Maps error: ${err.message}`);
      return collected;
    }
  }

  // ── Main search ──
  async function startSearch() {
    if (searching) return;
    setSearching(true);
    setLeads([]);
    setLogs([]);
    setProgress(0);
    setStats({ total: 0, hot: 0, noWeb: 0 });
    setError("");

    const currentFilters = { ...filters };
    let collected = [];

    // Google Maps
    if (sources.gm) {
      collected = await fetchGoogleMaps(collected, currentFilters);
      setProgress(45);
    }

    addLog(`🎯 Done! Total: ${collected.length} | Hot: ${collected.filter(l => l.hot).length}`, "success");
    setSearching(false);
  }

  // ── CSV Export ──
  function exportCSV() {
    if (!leads.length) return;
    const headers = ["Name", "Phone", "Address", "Rating", "Reviews", "Website", "Website Status", "Hot Lead"];
    const rows = leads.map(l => [
      l.name, l.phone || "", l.address || "",
      l.rating || "", l.reviewCount || "", l.website || "",
      l.websiteLabel, l.hot ? "YES" : "no"
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads_${location.replace(/[^a-z0-9]/gi, "_")}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Render ──
  return (
    <>
      <Head>
        <title>LeadHunter — Business Lead Generator</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="Find business leads worldwide using Google Maps" />
      </Head>

      <div style={{ background: "#0a0a0f", minHeight: "100vh", color: "#e8e8f0", fontFamily: "monospace", padding: "16px", maxWidth: 900, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid #2a2a3d" }}>
          <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: -1 }}>
            Lead<span style={{ color: "#00e5ff" }}>Hunter</span>
            <span style={{ fontSize: 10, color: "#6b6b8a", fontWeight: 400, marginLeft: 10 }}>v3.0</span>
          </div>
          <div style={{ fontSize: 10, color: "#6b6b8a", letterSpacing: 2, textTransform: "uppercase", marginTop: 4 }}>
            Google Maps — Worldwide Lead Generator
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div style={{ background: "rgba(255,61,113,0.1)", border: "1px solid rgba(255,61,113,0.4)", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: "#ff3d71", lineHeight: 1.6 }}>
            ❌ {error}
          </div>
        )}

        {/* Search Panel */}
        <div style={{ background: "#12121a", border: "1px solid #2a2a3d", borderRadius: 14, padding: 18, marginBottom: 16, borderTop: "2px solid #00e5ff" }}>
          <div style={{ fontSize: 10, color: "#6b6b8a", letterSpacing: 3, textTransform: "uppercase", marginBottom: 14 }}>// Search Config</div>

          {/* Location + Category */}
          <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 10, color: "#6b6b8a", textTransform: "uppercase", marginBottom: 5 }}>Location</div>
              <input value={location} onChange={e => setLocation(e.target.value)} style={inputStyle} placeholder="Dhaka, Bangladesh" />
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#6b6b8a", textTransform: "uppercase", marginBottom: 5 }}>Category</div>
              <select value={category} onChange={e => setCategory(e.target.value)} style={inputStyle}>
                <option value="restaurant">🍽 Restaurant</option>
                <option value="salon">✂️ Salon</option>
                <option value="clothing store">👗 Clothing Store</option>
                <option value="gym">💪 Gym</option>
                <option value="clinic">🏥 Clinic</option>
                <option value="bakery">🎂 Bakery / Cafe</option>
                <option value="photography studio">📸 Photography</option>
                <option value="travel agency">✈️ Travel Agency</option>
                <option value="electronics shop">📱 Electronics</option>
                <option value="real estate">🏠 Real Estate</option>
                <option value="coaching center">📚 Coaching Center</option>
                <option value="hotel">🏨 Hotel</option>
              </select>
            </div>
          </div>

          {/* Filters */}
          <div style={{ fontSize: 10, color: "#6b6b8a", textTransform: "uppercase", marginBottom: 7 }}>Hot Lead Filters</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
            {[["nowebsite", "❌ No Website"], ["lowrating", "⭐ Low Rating (<3.5)"]].map(([key, label]) => (
              <div key={key}
                onClick={() => setFilters(f => ({ ...f, [key]: !f[key] }))}
                style={{ padding: "5px 12px", borderRadius: 20, cursor: "pointer", fontSize: 11, border: `1px solid ${filters[key] ? "#ff3d71" : "#2a2a3d"}`, background: filters[key] ? "rgba(255,61,113,0.1)" : "#1a1a26", color: filters[key] ? "#ff3d71" : "#6b6b8a", userSelect: "none", transition: "all 0.2s" }}>
                {label}
              </div>
            ))}
          </div>

          {/* Search Button */}
          <button onClick={startSearch} disabled={searching}
            style={{ background: searching ? "#1a1a26" : "#00e5ff", color: searching ? "#555" : "#000", border: searching ? "1px solid #2a2a3d" : "none", borderRadius: 10, padding: "12px 28px", fontWeight: 900, fontSize: 13, cursor: searching ? "not-allowed" : "pointer", transition: "all 0.2s" }}>
            {searching ? "⏳ Searching..." : "⚡ Hunt Leads"}
          </button>

          {/* Progress Bar */}
          {searching && (
            <div style={{ height: 3, background: "#2a2a3d", borderRadius: 2, marginTop: 12, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg,#00e5ff,#a259ff)", borderRadius: 2, transition: "width 0.4s" }} />
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 16 }}>
          {[["Total", stats.total, "#00e5ff"], ["🔥 Hot", stats.hot, "#ff3d71"], ["No Web", stats.noWeb, "#ffaa00"]].map(([label, val, color]) => (
            <div key={label} style={{ background: "#12121a", border: "1px solid #2a2a3d", borderRadius: 10, padding: "12px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 900, color }}>{val}</div>
              <div style={{ fontSize: 9, color: "#6b6b8a", marginTop: 3, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Results Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Results ({leads.length})</div>
          <button onClick={exportCSV} disabled={!leads.length}
            style={{ background: "transparent", border: "1px solid #00e5ff", color: "#00e5ff", borderRadius: 8, padding: "6px 14px", fontSize: 11, cursor: leads.length ? "pointer" : "not-allowed", opacity: leads.length ? 1 : 0.4 }}>
            ↓ CSV Export
          </button>
        </div>

        {/* Lead Cards */}
        {leads.length === 0 && !searching ? (
          <div style={{ textAlign: "center", padding: "50px 20px", color: "#6b6b8a" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🎯</div>
            <div style={{ fontSize: 15, color: "#e8e8f0", marginBottom: 6 }}>Ready to Hunt</div>
            <div style={{ fontSize: 11 }}>Location + Category সেট করো এবং Hunt Leads চাপো</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {leads.map(lead => {
              return (
                <div key={lead.id} style={{ background: "#12121a", border: `1px solid ${lead.hot ? "#ff3d7133" : "#2a2a3d"}`, borderLeft: `3px solid ${lead.hot ? "#ff3d71" : "#00e5ff"}`, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.name}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {lead.phone && <span style={{ fontSize: 11, color: "#6b6b8a" }}>📞 {lead.phone}</span>}
                        {lead.address && <span style={{ fontSize: 11, color: "#6b6b8a" }}>📍 {lead.address.slice(0, 35)}</span>}
                        {lead.rating && <span style={{ fontSize: 11, color: "#6b6b8a" }}>⭐ {lead.rating}{lead.reviewCount ? ` (${lead.reviewCount})` : ""}</span>}
                        <span style={{ fontSize: 11, color: lead.hasWebsite ? "#00e676" : "#ff3d71" }}>{lead.websiteLabel}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end", alignItems: "flex-start" }}>
                      {!lead.hasWebsite && <span style={{ padding: "3px 8px", borderRadius: 20, fontSize: 9, fontWeight: 700, background: "rgba(255,61,113,0.1)", color: "#ff3d71", border: "1px solid rgba(255,61,113,0.3)", whiteSpace: "nowrap" }}>No Web</span>}
                      {lead.hot && <span style={{ padding: "3px 8px", borderRadius: 20, fontSize: 9, fontWeight: 700, background: "rgba(255,61,113,0.15)", color: "#ff3d71", border: "1px solid #ff3d71", whiteSpace: "nowrap" }}>🔥 Hot</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Activity Log */}
        {logs.length > 0 && (
          <div style={{ background: "#12121a", border: "1px solid #2a2a3d", borderRadius: 10, padding: 12, marginTop: 16 }}>
            <div style={{ fontSize: 9, color: "#6b6b8a", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>// Activity Log</div>
            <div style={{ maxHeight: 140, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
              {logs.map((l, i) => (
                <div key={i} style={{ fontSize: 11, color: l.type === "success" ? "#00e676" : l.type === "warn" ? "#ffaa00" : l.type === "error" ? "#ff3d71" : "#6b6b8a", display: "flex", gap: 6 }}>
                  <span style={{ color: "#00e5ff", opacity: 0.4, flexShrink: 0 }}>[{l.time}]</span>
                  <span>{l.msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ height: 40 }} />
      </div>
    </>
  );
}
