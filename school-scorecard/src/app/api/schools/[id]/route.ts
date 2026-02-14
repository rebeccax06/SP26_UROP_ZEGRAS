import { NextResponse } from 'next/server';
import { getSchool } from '@/lib/providers/school';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const school = await getSchool(id);
  if (!school) {
    return NextResponse.json({ error: 'School not found' }, { status: 404 });
  }
  return NextResponse.json(school);
}
