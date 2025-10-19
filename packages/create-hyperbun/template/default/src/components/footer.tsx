const Footer = () => {
  return (
    <footer className="mt-auto border-t border-gray-800 bg-black px-6 py-4 text-sm text-gray-400">
      <p className="flex flex-wrap items-center justify-between gap-3 text-gray-400">
        <span>Copyright © {new Date().getFullYear()} __APP_TITLE__</span>
        <span className="text-gray-500">Built with HyperBun.</span>
      </p>
    </footer>
  );
};

export default Footer;
