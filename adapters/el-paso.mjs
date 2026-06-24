// El Paso Electric adapter. The collector POSTs to starlit.epelectric.com/OmsApi/GetOutages (x-api-key)
// and DECRYPTS the AES-256-GCM envelope (see collect_utility.fetchElPaso) before this parser runs. The
// decrypted JSON has totals + customersAffectedPerZipcode[] (areas) + outages[] (per-incident loc/etr).
const num = (v) => (typeof v === "number" && isFinite(v)) ? v : 0;

// raw = decrypted JSON: { totalCustAffected, totalActiveCustomers, totalOutageCount,
//   customersAffectedPerZipcode:[{zipcode,customersAffected}], outages:[{zipcode,latitude,longitude,etr,...}] }
export function parseElPaso(raw, opts = {}) {
  const zips = raw && Array.isArray(raw.customersAffectedPerZipcode) ? raw.customersAffectedPerZipcode : null;
  if (!zips) throw new Error("el-paso: missing customersAffectedPerZipcode");
  const byZip = {};
  for (const o of (Array.isArray(raw.outages) ? raw.outages : [])) { const z = String(o.zipcode || ""); (byZip[z] = byZip[z] || []).push(o); }
  const areas = zips.map((z) => {
    const zip = String(z.zipcode || "(zip)");
    const out = Math.max(0, num(z.customersAffected));
    const os = byZip[zip] || [];
    const lat = os.length ? num(os[0].latitude) : 0, lon = os.length ? num(os[0].longitude) : 0;
    const etr = os.map((o) => o.etr).filter((e) => typeof e === "string")[0] || null;
    return { name: zip, out, served: out, etr, loc: (lat || lon) ? [lat, lon] : null, subs: [] };
  });
  if (!areas.length) throw new Error("el-paso: no zip areas");
  return { official: { out: Math.max(0, num(raw.totalCustAffected)), served: Math.max(0, num(raw.totalActiveCustomers)) || num(opts.servedTotal), nOut: Math.max(0, num(raw.totalOutageCount)) }, areas };
}
