import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deleteHotelInvite } from "@/app/partenaire/actions";
import CopyLink from "@/components/CopyLink";
import { getOrigin } from "@/lib/origin";
import { qrSvg } from "@/lib/qr";
import { APP_NAME } from "@/lib/config";
import { UUID_RE } from "@/lib/utils";
import { formatMoney, getPartner, hotelStatus, monthlyCommission, planLabel, type PartnerHotel } from "@/lib/partners";

/** Un hôtel présenté par le partenaire : le QR à faire scanner au gérant, puis son statut. */
export default async function PartnerHotelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) redirect(`/login?next=/partenaire/hotel/${id}`);

  const [partner, { data }] = await Promise.all([getPartner(supabase, user.id), supabase.rpc("partner_hotels")]);
  if (!partner) redirect("/partenaire");
  const hotel = ((data ?? []) as PartnerHotel[]).find((h) => h.invite_id === id);
  if (!hotel) notFound();

  const st = hotelStatus(hotel);
  const plan = planLabel(hotel);
  const url = `${await getOrigin()}/rejoindre/${hotel.token}`;
  const hello = hotel.contact_name ? `Bonjour ${hotel.contact_name}, ` : "Bonjour, ";
  const message = `${hello}voici le lien pour créer l’espace ${APP_NAME} de ${hotel.hotel_name} (2 minutes, gratuit pour commencer) :`;

  return (
    <main className="mx-auto min-h-dvh max-w-xl space-y-6 px-4 py-6 pb-16">
      <div>
        <Link href="/partenaire" className="text-sm text-slate-500">← Espace partenaire</Link>
        <h1 className="mt-3 text-2xl font-bold">{hotel.hotel_name}</h1>
        <p className="text-sm text-slate-500">
          {[hotel.contact_name, hotel.contact_phone].filter(Boolean).join(" · ") ||
            `Ajouté le ${new Date(hotel.invited_at).toLocaleDateString("fr-FR")}`}
        </p>
      </div>

      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
        <p className="text-sm text-slate-500">Statut</p>
        <p className="mt-1 text-xl font-bold">{st.label}</p>
        {st.paying && plan && (
          <p className="mt-1 text-slate-700">
            Forfait {plan} · <strong>{formatMoney(monthlyCommission(hotel, partner.commission_percent))} / mois pour vous</strong>
          </p>
        )}
        {!hotel.claimed_at && <p className="mt-1 text-sm text-slate-600">Le gérant n’a pas encore créé son espace.</p>}
        {hotel.claimed_at && !st.paying && st.label === "Essai gratuit" && (
          <p className="mt-1 text-sm text-slate-600">
            Espace créé le {new Date(hotel.claimed_at).toLocaleDateString("fr-FR")}. Votre commission commence à son premier paiement.
          </p>
        )}
      </section>

      {!hotel.claimed_at && (
        <section className="rounded-3xl bg-white p-5 text-center shadow-sm ring-1 ring-slate-100">
          <h2 className="text-lg font-semibold">Faites scanner ce QR code au gérant</h2>
          <p className="mt-1 text-sm text-slate-600">Il crée l’espace de son hôtel sur son téléphone. L’hôtel est alors relié à vous.</p>
          <div className="mx-auto mt-4 w-64 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: await qrSvg(url) }} />
          <p className="mt-4 text-sm text-slate-600">Pas sur place ? Envoyez-lui le lien :</p>
          <div className="mt-2 flex justify-center">
            <CopyLink url={url} message={message} />
          </div>
          <form action={deleteHotelInvite} className="mt-6">
            <input type="hidden" name="id" value={hotel.invite_id} />
            <button className="text-sm text-slate-400 underline hover:text-red-600">Supprimer cet hôtel de ma liste</button>
          </form>
        </section>
      )}
    </main>
  );
}
