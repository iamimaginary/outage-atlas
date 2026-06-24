// FPL adapter. Florida Power & Light publishes plain county-total JSON (NOT Kübra). FPL serves TWO
// non-overlapping regions that must be merged: the main peninsula and the Northwest/panhandle (former
// Gulf Power). County grain carries BOTH out and served (the cleanest non-Kübra shape we have). Numbers
// arrive as comma-formatted strings. No CORS on the feed -> the collector fetches it server-side.

const toInt = (v) => { const n = parseInt(String(v == null ? "" : v).replace(/[,\s]/g, ""), 10); return isFinite(n) ? n : 0; };

function regionAreas(doc) {
  const rows = (doc && Array.isArray(doc.outages)) ? doc.outages : [];
  return rows.map((c) => {
    const served = toInt(c["Customers Served"]);
    const o = Math.max(0, toInt(c["Customers Out"]));
    return { name: String(c["County Name"] || "(unknown)"), out: served > 0 ? Math.min(o, served) : o, served, etr: null, loc: null, subs: [] };
  });
}

// raw = { main: <CountyOutages.json>, nw: <northwest CountyOutages.json>|null }
export function parseFpl(raw) {
  if (!raw || (!raw.main && !raw.nw)) throw new Error("fpl: missing main/nw CountyOutages");
  const areas = [...regionAreas(raw.main), ...regionAreas(raw.nw)];
  if (!areas.length) throw new Error("fpl: no county rows");
  const official = {
    out: areas.reduce((a, x) => a + x.out, 0),
    served: areas.reduce((a, x) => a + x.served, 0),
    nOut: areas.filter((x) => x.out > 0).length,
  };
  return { official, areas };
}
