import { createRootRoute, createRoute, createRouter, Link, Outlet } from '@tanstack/react-router'
import { ConnectButton } from './components/ConnectButton'
import { AuctionPage } from './pages/AuctionPage'
import { ListPage } from './pages/ListPage'
import { MePage } from './pages/MePage'
import { SellPage } from './pages/SellPage'

function Layout() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800">
        <div className="mx-auto flex max-w-4xl items-center gap-6 px-4 py-3">
          <Link to="/" className="font-semibold tracking-tight text-emerald-400">
            ChainBid
          </Link>
          <nav className="flex gap-4 text-sm text-zinc-400">
            <Link to="/" className="hover:text-zinc-100 [&.active]:text-zinc-100">
              Auctions
            </Link>
            <Link to="/sell" className="hover:text-zinc-100 [&.active]:text-zinc-100">
              Sell
            </Link>
            <Link to="/me" className="hover:text-zinc-100 [&.active]:text-zinc-100">
              Me
            </Link>
          </nav>
          <div className="ml-auto">
            <ConnectButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}

const rootRoute = createRootRoute({ component: Layout })
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: ListPage })
const auctionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auction/$contractAddress/$auctionId',
  component: AuctionPage,
})
const sellRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sell',
  component: SellPage,
})
const meRoute = createRoute({ getParentRoute: () => rootRoute, path: '/me', component: MePage })

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, auctionRoute, sellRoute, meRoute]),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
