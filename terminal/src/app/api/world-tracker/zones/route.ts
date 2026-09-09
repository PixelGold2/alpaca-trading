import { verifySession } from "@/lib/auth/dal";
import { getAllZones } from "@/lib/world-tracker/zones-store";

export const dynamic = "force-dynamic";

/** Conflict zones + maritime blockades/restrictions, AI-scanned roughly once a day (see zone-scan-cycle.ts). */
export async function GET() {
  await verifySession();
  const zones = await getAllZones();
  return Response.json({ data: zones });
}
