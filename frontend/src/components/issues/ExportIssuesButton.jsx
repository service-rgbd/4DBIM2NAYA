import { useState } from "react";
import { toast } from "sonner";
import { FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, errMsg } from "@/lib/api";

/** Downloads the PDF list of issues matching the current filters (grouped by company when none is chosen). */
export default function ExportIssuesButton({ pid, filters, disabled }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.get(`/projects/${pid}/reports/issues`, { params: filters, responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const slug = filters.company ? filters.company.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "toutes-entreprises";
      Object.assign(document.createElement("a"), { href: url, download: `reserves-${slug}-${new Date().toISOString().slice(0, 10)}.pdf` }).click();
      URL.revokeObjectURL(url);
      toast.success("Export PDF des réserves généré");
    } catch (e) {
      toast.error(e?.response?.data instanceof Blob ? JSON.parse(await e.response.data.text()).detail : errMsg(e));
    } finally { setBusy(false); }
  };
  return (
    <Button data-testid="issues-export-pdf-btn" variant="outline" onClick={run} disabled={busy || disabled}>
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}Exporter PDF
    </Button>
  );
}
