import Scout from "../../scout";
import data from "@/public/data/conference.json";
export function generateStaticParams() {
  return data.sessions.map((s) => ({ id: s.id }));
}
export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Scout view="session" sessionId={id} />;
}
