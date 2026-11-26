import { useRef, type ReactNode } from 'react';
import type { MediaItem } from '@umh/types';
import MediaCard from './MediaCard';
import { Icon } from './icons';

export default function Row({ title, items, action }: { title: ReactNode; items: MediaItem[]; action?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  if (!items.length) return null;
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * (ref.current.clientWidth * 0.85), behavior: 'smooth' });
  return (
    <section className="row">
      <div className="row-head">
        <h2 className="row-title">{title}</h2>
        <div className="row-nav">
          {action}
          <button className="row-arrow" onClick={() => scroll(-1)} aria-label="Précédent">
            <Icon name="chevron-left" size={18} />
          </button>
          <button className="row-arrow" onClick={() => scroll(1)} aria-label="Suivant">
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      </div>
      <div className="row-scroll" ref={ref}>
        {items.map((it) => (
          <MediaCard key={it.id} item={it} />
        ))}
      </div>
    </section>
  );
}
