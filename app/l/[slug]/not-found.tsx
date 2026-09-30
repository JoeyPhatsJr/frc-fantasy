import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChevronLeft } from '@/components/ui/icons';

export default function LeagueNotFound() {
  return (
    <main id="main" className="space-y-6">
      <Card className="space-y-4">
        <h1 className="font-display text-3xl font-bold uppercase leading-tight tracking-wide text-fg">
          Nothing here
        </h1>
        <p className="text-fg">
          That league or round doesn&apos;t exist. Check the link in the group chat, or ask the commissioner for
          a new one.
        </p>
        <Button href="/" variant="secondary">
          <ChevronLeft className="size-5 shrink-0" />
          FRC Fantasy home
        </Button>
      </Card>
    </main>
  );
}
