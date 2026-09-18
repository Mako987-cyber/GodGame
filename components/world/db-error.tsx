export function DatabaseError({ message }: { message: string }) {
  return (
    <div role="alert" className="border-war/40 bg-war/5 rounded-lg border p-4 text-sm">
      <p className="text-war font-medium">Impossibile leggere i mondi dal database.</p>
      <p className="text-muted mt-1">{message}</p>
      <p className="text-muted mt-1">
        Verifica DATABASE_URL e che le migrazioni siano state applicate (npm run db:migrate).
      </p>
    </div>
  );
}
