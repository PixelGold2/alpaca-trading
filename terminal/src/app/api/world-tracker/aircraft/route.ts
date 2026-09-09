import { verifySession } from "@/lib/auth/dal";
import { getMilitaryAircraft } from "@/lib/world-tracker/aircraft-provider";

export const dynamic = "force-dynamic";

export async function GET() {
  await verifySession();
  const result = await getMilitaryAircraft();
  return Response.json(result);
}
