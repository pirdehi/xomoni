import 'server-only';
import { notFound } from 'next/navigation';
import { SECTIONS, type Section, sectionFromSlug } from '../domain/sections';

export type { Section } from '../domain/sections';

/** The dashboard place an address names (`undefined` is Overview), or Next.js's 404 for one that doesn't exist (#245). */
export function sectionOr404(slug?: string): Section {
  const section = sectionFromSlug(slug);
  if (!section) notFound();
  return section;
}

/** Every place's address segment under `/dashboard/`, for the route to list them (Overview is `/dashboard` itself). */
export function sectionSlugs(): string[] {
  return SECTIONS.filter((section) => section.id !== 'overview').map((section) => section.id);
}

/** The title of the page at `/dashboard/<slug>`: the place's name, or *Dashboard* for an address that names none. */
export function sectionTitle(slug: string): string {
  return sectionFromSlug(slug)?.label ?? 'Dashboard';
}
