import { Open16Regular } from '@fluentui/react-icons';
import { WEBSITE_ORIGIN } from '@xomoni/bridge';
import { Card } from '../ui';

/** The digests' page on xomoni.com, as it is: no extension id, nothing about the person, so it is the same for everyone. */
export const ALGORITHM_DIGEST_URL = `${WEBSITE_ORIGIN}/algorithm`;

/**
 * Reach's link to the monthly digest of X's open ranking code (#430, ADR-0046): what it is, what it can't tell, and
 * *Read the digests on xomoni.com* in a new tab. The extension fetches nothing for it, so its Content-Security-Policy
 * and permissions don't change, and no digest needs a release of Xomoni.
 */
export function AlgorithmDigestCard() {
  return (
    <Card
      title="What changed in X’s ranking code"
      subtitle="A monthly digest on xomoni.com, made from the code X publishes for its recommendations, and from nothing else."
    >
      <p>
        Each month X’s open-source ranking code changes, a person writes down what changed in how it is built and checks
        it against the code. X hides the real weights, so a digest can’t tell how much any change moves your reach.
      </p>
      <p>
        <a href={ALGORITHM_DIGEST_URL} target="_blank" rel="noopener noreferrer">
          Read the digests on xomoni.com <Open16Regular aria-hidden />
        </a>
      </p>
    </Card>
  );
}
