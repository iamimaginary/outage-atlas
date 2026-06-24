// OMAP adapter — PPL's ASP.NET "OMAP" platform, multi-tenant by host: PPL Electric (PA) and Rhode
// Island Energy (Narragansett). GET <base>/api/Omap/Outage/Tabular?opco=PA returns a county->township
// tree WITH served counts (tc). No ETR in the Tabular payload. Pure raw->canonical.
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;
const clamp = (o, s) => { o = Math.max(0, num(o)); return s > 0 ? Math.min(o, s) : o; };
const loc = (a, o) => { a = num(a); o = num(o); return (a || o) ? [a, o] : null; };

// raw = { nc, oc, data:[ {nm,nc,tc,a,o, mun:[{nm,nc,tc,a,o,index}]} ] }
export function parseOmap(raw) {
  const d = raw && Array.isArray(raw.data) ? raw.data : null;
  if (!d) throw new Error("omap: missing data[]");
  const areas = d.map((c) => {
    const served = num(c.tc);
    return {
      name: String(c.nm || "(county)"), out: clamp(c.nc, served), served, etr: null, loc: loc(c.a, c.o),
      subs: (Array.isArray(c.mun) ? c.mun : []).map((m) => ({ id: String(m.index != null ? m.index : `${c.nm}|${m.nm}`), name: String(m.nm || "(area)"), out: clamp(m.nc, num(m.tc)), served: num(m.tc), etr: null, loc: loc(m.a, m.o) })),
    };
  });
  if (!areas.length) throw new Error("omap: no areas");
  const hc = parseInt(raw.nc, 10);
  return { official: { out: Math.max(0, isFinite(hc) ? hc : areas.reduce((a, x) => a + x.out, 0)), served: areas.reduce((a, x) => a + x.served, 0), nOut: Math.max(0, num(parseInt(raw.oc, 10))) }, areas };
}
