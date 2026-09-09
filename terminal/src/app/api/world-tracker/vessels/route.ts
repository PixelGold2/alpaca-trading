import { verifySession } from "@/lib/auth/dal";
import { ensureVesselTrackerStarted, getVesselSnapshot } from "@/lib/world-tracker/vessel-tracker";

export const dynamic = "force-dynamic";

export async function GET() {
  await verifySession();
  ensureVesselTrackerStarted();
  return Response.json(await getVesselSnapshot());
}
