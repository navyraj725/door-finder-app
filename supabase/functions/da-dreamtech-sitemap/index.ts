import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SitemapLocation {
  slug: string;
  level: string;
  region: string | null;
  district: string | null;
  name: string;
  is_active: boolean;
}

interface SitemapProperty {
  id: string;
  status: string;
  district: string | null;
  area: string | null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const sitemapType = url.searchParams.get("type") || "index";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    };

    const now = encodeURIComponent(new Date().toISOString());

    const [locationsRes, propertiesRes] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/uganda_locations?select=slug,level,region,district,name,is_active&is_active=eq.true`,
        { headers }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/properties?select=id,status,district,area&status=eq.available&or=(expires_at.is.null,expires_at.gt.${now})`,
        { headers }
      ),
    ]);

    const locations = (await locationsRes.json()) as SitemapLocation[];
    const properties = (await propertiesRes.json()) as SitemapProperty[];

    const baseUrl = "https://doorfinder.ug";
    const functionsUrl = `${supabaseUrl}/functions/v1/da-dreamtech-sitemap`;
    const categories = ["houses-for-rent", "apartments", "hotels", "rentals", "guest-houses", "warehouses", "airbnb"];

    // Districts that actually have properties
    const districtsWithProps = new Set<string>();
    for (const p of properties) {
      if (p.district) districtsWithProps.add(p.district);
    }

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';

    if (sitemapType === "index") {
      xml += '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
      const sitemapTypes = ["locations", "category-pages", "property-listings", "static-pages"];
      for (const st of sitemapTypes) {
        xml += `  <sitemap><loc>${functionsUrl}?type=${st}</loc></sitemap>\n`;
      }
      xml += '</sitemapindex>';
    } else {
      xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

      if (sitemapType === "property-listings") {
        for (const p of properties) {
          xml += `  <url><loc>${baseUrl}/?property=${escapeXml(p.id)}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
        }
      } else if (sitemapType === "category-pages") {
        const districts = locations.filter(
          (l) => l.level === "district" && districtsWithProps.has(l.name) && l.region
        );
        for (const d of districts) {
          for (const cat of categories) {
            xml += `  <url><loc>${baseUrl}/uganda/${slugify(d.region!)}/${escapeXml(d.slug)}/${cat}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
          }
        }
      } else if (sitemapType === "locations") {
        const districtLocations = locations.filter(
          (l) => l.level === "district" && districtsWithProps.has(l.name)
        );
        for (const l of districtLocations) {
          xml += `  <url><loc>${baseUrl}${buildPath(l)}</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>\n`;
        }
        xml += `  <url><loc>${baseUrl}/uganda</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>\n`;
      } else if (sitemapType === "static-pages") {
        for (const path of ["", "/pricing", "/about", "/terms", "/privacy", "/cookies", "/report"]) {
          xml += `  <url><loc>${baseUrl}${path}</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>\n`;
        }
      }

      xml += '</urlset>';
    }

    return new Response(xml, {
      headers: { ...corsHeaders, "Content-Type": "application/xml" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Sitemap generation failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function buildPath(loc: SitemapLocation): string {
  const parts = ["uganda"];
  if (loc.region && loc.level !== "region") {
    parts.push(slugify(loc.region));
  }
  if (loc.district && loc.level !== "district") {
    parts.push(slugify(loc.district));
  }
  parts.push(loc.slug);
  return "/" + parts.join("/") + "/";
}
