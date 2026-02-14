import { NextResponse } from 'next/server';
import { listSchools } from '@/lib/providers/school';

export async function GET() {
  const schools = await listSchools();
  return NextResponse.json(schools);
}
