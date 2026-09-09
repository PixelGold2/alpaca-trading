import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/dal";
import { generateMarketBrief } from "@/lib/research/market-brief";

export async function GET() {
  await verifySession();
  const result = await generateMarketBrief();
  return NextResponse.json(result);
}
