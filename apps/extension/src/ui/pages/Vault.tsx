import { makeStyles, tokens } from '@fluentui/react-components';
import { useId } from 'react';
import { AccountTimeline } from '../components/vault/AccountTimeline';
import { ImportLedger } from '../components/vault/ImportLedger';
import { VaultDrop } from '../components/vault/VaultDrop';
import { VaultSources } from '../components/vault/VaultSources';
import { PageHeader } from '../components/ui';
import type { PageProps } from '../navigation';

const useStyles = makeStyles({
  stack: { display: 'grid', gap: tokens.spacingVerticalL },
  pair: {
    display: 'grid',
    gap: tokens.spacingVerticalL,
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))',
    alignItems: 'start',
  },
});

/**
 * The Vault page (#425, ADR-0043): X's official files kept on this computer. *Your sources* (how fresh each is and
 * what it holds), *Add files* (drop X's archive and analytics export), *Imports* (the ledger) and the *Account
 * timeline*. Nothing on it acts on X or sends anything anywhere.
 */
export function VaultPage({ account, navigate }: PageProps) {
  const styles = useStyles();
  const ledgerId = useId();
  return (
    <div className={styles.stack}>
      <PageHeader
        title="Vault"
        description={`X’s own files about @${account.handle}, kept on this computer: your archive, your analytics and X’s Under the hood reports, with what came in and when. Nothing here is sent anywhere.`}
      />
      <div className={styles.pair}>
        <VaultSources account={account} navigate={navigate} />
        <VaultDrop account={account} ledgerId={ledgerId} />
      </div>
      <ImportLedger account={account} id={ledgerId} />
      <AccountTimeline account={account} />
    </div>
  );
}
