'use client';
// A place of the dashboard that isn't built yet (#245): what it will show and where its data will come from, instead
// of an empty page. On Fluent UI (ADR-0019).
import { Badge, makeStyles, tokens, typographyStyles } from '@fluentui/react-components';
import { Checkmark16Regular, Info16Regular } from '@fluentui/react-icons';
import { GITHUB_URL } from '@/shared/config/site';
import { TextLink } from '@/shared/ui/links';
import type { Section } from '../domain/sections';
import { SECTION_ICON } from './dashboard-frame';

const useStyles = makeStyles({
  card: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalL,
    padding: tokens.spacingHorizontalXXL,
    borderRadius: tokens.borderRadius2XLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  head: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM },
  icon: {
    display: 'grid',
    placeItems: 'center',
    width: '40px',
    height: '40px',
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
  },
  lead: { ...typographyStyles.subtitle2, margin: 0, color: tokens.colorNeutralForeground1 },
  list: { display: 'grid', gap: tokens.spacingVerticalS, margin: 0, padding: 0 },
  point: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalS,
    listStyleType: 'none',
    ...typographyStyles.body1,
    color: tokens.colorNeutralForeground2,
  },
  check: { flexShrink: 0, marginTop: '3px', color: tokens.colorBrandForeground1 },
  source: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalS,
    margin: 0,
    ...typographyStyles.caption1,
    color: tokens.colorNeutralForeground3,
  },
});

/**
 * What a place not built yet will show (`section.shows`), where its data will come from (`section.source`), and the
 * issue that builds it. Marked *Coming soon*, so nobody mistakes it for an empty account.
 */
export function SectionPreview({ section }: { section: Section }) {
  const s = useStyles();
  const Icon = SECTION_ICON[section.id];
  return (
    <section className={s.card} aria-label={`${section.label}: coming soon`}>
      <div className={s.head}>
        <span className={s.icon} aria-hidden>
          <Icon />
        </span>
        <p className={s.lead}>What {section.label} will show</p>
        <Badge appearance="tint" color="informative">
          Coming soon
        </Badge>
      </div>
      <ul className={s.list}>
        {section.shows.map((point) => (
          <li key={point} className={s.point}>
            <Checkmark16Regular className={s.check} aria-hidden />
            {point}
          </li>
        ))}
      </ul>
      <p className={s.source}>
        <Info16Regular aria-hidden />
        <span>
          From: {section.source}.
          {section.issue !== undefined && (
            <>
              {' '}
              Follow the work in <TextLink href={`${GITHUB_URL}/issues/${section.issue}`}>#{section.issue}</TextLink>.
            </>
          )}
        </span>
      </p>
    </section>
  );
}
