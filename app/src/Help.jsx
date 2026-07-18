import React from 'react';

// In-app guide. Written for the person at the table, not the developer.
export default function Help() {
  return (
    <div className="helppage">
      <h2>How to use the Companion</h2>

      <section>
        <h3>The DM screen (home)</h3>
        <ul>
          <li>Search <strong>Monsters / NPCs / Characters / Spells</strong> and click a result to pin it as a tab.</li>
          <li>Every pinned combatant tracks its <strong>own HP, temp HP, and conditions</strong> — pin the same monster twice for two goblins with separate wounds.</li>
          <li>Use the filter chips (<em>All · Monsters · NPCs · Spells…</em>) to see one kind of tab at a time when the bar gets crowded.</li>
          <li>Tabs and combat state survive restarts, and <strong>Export campaign</strong> downloads a file you can import in any browser.</li>
        </ul>
      </section>

      <section>
        <h3>Rolling dice</h3>
        <ul>
          <li>Anything red or underlined rolls: <strong>attack buttons</strong>, damage chips, saves, skills, ability scores, initiative.</li>
          <li>Every d20 roll asks <strong>Advantage / Normal / Disadvantage</strong> first.</li>
          <li>The rolls panel stays locked to the right while you scroll. The <strong>d20 button</strong> is always one click; the <strong>+</strong> opens every die plus a formula box (Roll20 syntax: <code>2d20kh1+5</code>, <code>8d6</code>, <code>4d6kh3</code>).</li>
        </ul>
      </section>

      <section>
        <h3>Finding things</h3>
        <ul>
          <li><strong>Search first</strong> — with 100,000+ entries, the search box beats scrolling every time.</li>
          <li>Your search and filters are remembered when you open an entry and come back; <strong>clear filters</strong> starts you over.</li>
          <li><span className="badge legacy">legacy</span> marks 2014-rules versions; the 2024 version is shown by default when both exist.</li>
        </ul>
      </section>

      <section id="privacy">
        <h3>Homebrew privacy — keeping DM secrets</h3>
        <p>Every homebrew entry has a privacy level, chosen when you save it:</p>
        <table className="mdtable">
          <tbody>
            <tr>
              <td><span className="badge tier-private">private</span></td>
              <td><strong>Default.</strong> Saved on the server but visible only to your DM profile — other people at the table never see it in any list, search, or screen. Follows you to paired devices.</td>
            </tr>
            <tr>
              <td><span className="badge">shared</span></td>
              <td>Visible to everyone using this server. Share deliberately; you can <em>unshare</em> later and it disappears from everyone else again.</td>
            </tr>
            <tr>
              <td><span className="badge tier-local">this device</span></td>
              <td>Never touches the server at all — it exists only in this browser. True secrecy, but <strong>export a stash backup</strong>: clearing browser data erases it.</td>
            </tr>
          </tbody>
        </table>
        <p className="muted">
          Honest note: “private” hides entries from every screen and search, which is what keeps
          spoilers safe among friends — it is not encryption.
        </p>
      </section>

      <section id="pairing">
        <h3>Your DM profile &amp; pairing a second device</h3>
        <ol>
          <li>On the <strong>Homebrew</strong> page, create your DM profile once (just a name). This browser now holds your key.</li>
          <li>To use your private homebrew on another device (the table tablet, your laptop): click <strong>show pairing code</strong> and copy the code shown.</li>
          <li>On the other device, open Homebrew, enter your DM name, paste the code, and hit <strong>pair this device</strong>. Both devices now see the same private table.</li>
        </ol>
        <p className="muted">Lost all paired devices? The key is gone with them — recreate a profile and re-save. Keep one paired backup device or a stash export for anything precious.</p>
      </section>

      <section>
        <h3>Characters &amp; campaigns</h3>
        <ul>
          <li><strong>Characters</strong> live on the server and appear on every device — build with the wizard, level up from the sheet header.</li>
          <li><strong>Campaign files</strong> (DM screen → Export) carry your pinned tabs and combat state between browsers. Characters and homebrew stay on the server and are never embedded.</li>
        </ul>
      </section>
    </div>
  );
}
