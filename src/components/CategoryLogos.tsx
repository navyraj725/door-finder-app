import { Home, Building2, Hotel, BedDouble, KeyRound, Warehouse, DoorOpen, Tag } from 'lucide-react';

const ICONS: Record<string, typeof Home> = {
  Houses: Home,
  Apartments: Building2,
  Hotels: Hotel,
  'Guest Houses': BedDouble,
  Rentals: KeyRound,
  Warehouses: Warehouse,
  Airbnb: DoorOpen,
};

export function CategoryLogo({ category, size = 24 }: { category: string; size?: number }) {
  const Icon = ICONS[category] || Tag;
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" />;
}
