import { QRCodeSVG } from "qrcode.react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { QrCode } from "lucide-react";
import { podQrPayload } from "@/lib/pods/podSync";

export interface SeedRow {
  id: string;
  pod_key: string;
  capability: string;
  version: number;
  content_hash: string | null;
}

export function SeedQrButton({ row, color, glyph, name }: { row: SeedRow; color: string; glyph: string; name: string }) {
  const payload = podQrPayload(row);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" aria-label={`Seed QR for ${name}`}>
          <QrCode className="w-3 h-3 mr-1" /> Seed QR
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span aria-hidden style={{ color }}>{glyph}</span> {name} · seed v{row.version}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          <div className="p-3 rounded-md bg-card border border-border">
            <QRCodeSVG value={payload} size={220} bgColor="transparent" fgColor={color} level="M" />
          </div>
          <p className="text-[11px] text-muted-foreground text-center">
            No secrets encoded. Scanning resolves this seed's metadata through
            <span className="font-mono"> pod-fetch</span> using the scanner's own session.
            The compressed payload stays on the device that sealed it.
          </p>
          <pre className="w-full text-[10px] font-mono bg-muted/30 p-2 rounded overflow-auto max-h-32">{payload}</pre>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigator.clipboard.writeText(payload)}
          >
            Copy payload
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
