import styles from './CompareTable.module.css';

interface CompareRow {
  account: { id: string; name: string };
  latestSnapshot: { followersCount: number; avgEr: number | null } | null;
}

export function CompareTable({ rows }: { rows: CompareRow[] }) {
  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Аккаунт</th>
            <th>Подписчики</th>
            <th>ER</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.account.id}>
              <td>{row.account.name}</td>
              <td className={styles.numeric}>{row.latestSnapshot?.followersCount ?? '—'}</td>
              <td className={styles.numeric}>
                {row.latestSnapshot?.avgEr != null ? `${row.latestSnapshot.avgEr.toFixed(1)}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
