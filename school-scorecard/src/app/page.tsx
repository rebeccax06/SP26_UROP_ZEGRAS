import Link from 'next/link';

export default function HomePage() {
  return (
    <main style={{ padding: 24, maxWidth: 600 }}>
      <h1>School Reliability Scorecard</h1>
      <p>MBTA bus reliability around schools. Select a school to view the scorecard and map.</p>
      <ul>
        <li>
          <Link href="/school/demo">Demo School</Link>
        </li>
      </ul>
    </main>
  );
}
