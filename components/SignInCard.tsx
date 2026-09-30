import { SignInButtons } from '@/components/SignInButtons';
import { Card } from '@/components/ui/Card';

export function SignInCard({ title, next }: { title: string; next: string }) {
  return (
    <main id="main">
      <Card title={title} className="space-y-4">
        <SignInButtons next={next} />
      </Card>
    </main>
  );
}
