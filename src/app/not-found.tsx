import Link from 'next/link';
import { Compass } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function NotFound() {
  return (
    <Card className="mx-auto mt-8 max-w-lg">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Compass className="size-5" />
        </span>
        <h2 className="text-lg font-semibold">Off the pitch</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          That route does not exist. Today&apos;s fixtures, the leagues and the accuracy report are one tap away.
        </p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <Button asChild variant="outline">
            <Link href="/">Today</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/fixtures">Fixtures</Link>
          </Button>
          <Button asChild>
            <Link href="/accuracy">Accuracy</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
